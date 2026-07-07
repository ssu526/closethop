import hashlib
import io
import json
import logging
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse
from urllib.parse import unquote_plus

import boto3
from google import genai
from google.genai import types
from PIL import Image, ImageOps
import psycopg2
from pydantic import BaseModel, Field, ValidationError

try:
    from rembg import remove, new_session
except Exception as exc:  # pragma: no cover - fallback for local test/runtime issues
    logger = logging.getLogger("closethop.image_worker")
    logger.warning("Unable to import rembg; falling back to light background removal: %s", exc)

    def remove(image, **_kwargs):
        raise ValueError("REMBG_UNAVAILABLE")

    def new_session(_name):
        return None


class ClothingMetadata(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=20)


S3_BUCKET = os.environ["IMAGE_BUCKET"]
RESULT_QUEUE_URL = os.environ["RESULT_QUEUE_URL"]
PUBLIC_URL = os.environ["PUBLIC_URL"].rstrip("/")
MODEL = os.getenv("VISION_MODEL", "gemini-2.5-flash-lite")
PROVIDER = os.getenv("VISION_PROVIDER", "gemini")
SCHEMA_VERSION = os.getenv("VISION_SCHEMA_VERSION", "2")
AWS_ENDPOINT_URL = os.getenv("AWS_ENDPOINT_URL") or None
DATASOURCE_SECRET_ARN = os.getenv("DATASOURCE_SECRET_ARN")
DATASOURCE_URL = os.getenv("DATASOURCE_URL")
DATASOURCE_USERNAME = os.getenv("DATASOURCE_USERNAME")
DATASOURCE_PASSWORD = os.getenv("DATASOURCE_PASSWORD")
DATASOURCE_DB_NAME = os.getenv("DATASOURCE_DB_NAME", "closethop")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
SECRET_ARN = os.getenv("GEMINI_SECRET_ARN")
METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").lower() == "true"
CLASSIFICATION_PROMPT_PATH = Path(os.getenv(
    "CLASSIFICATION_PROMPT_PATH",
    Path(__file__).resolve().parent / "prompts" / "clothing_classifier_prompt.txt",
))

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("closethop.image_worker")


def aws_client(service: str):
    return boto3.client(service, endpoint_url=AWS_ENDPOINT_URL)


s3 = aws_client("s3")
sqs = aws_client("sqs")
secrets = aws_client("secretsmanager")
cloudwatch = aws_client("cloudwatch")


@lru_cache(maxsize=1)
def classification_prompt() -> str:
    return CLASSIFICATION_PROMPT_PATH.read_text(encoding="utf-8").strip()


@lru_cache(maxsize=1)
def gemini_client():
    if GEMINI_API_KEY:
        return genai.Client(api_key=GEMINI_API_KEY)
    if not SECRET_ARN:
        raise ValueError("GEMINI_API_KEY_OR_SECRET_REQUIRED")
    secret = secrets.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
    try:
        api_key = json.loads(secret)["apiKey"]
    except (json.JSONDecodeError, TypeError, KeyError):
        api_key = secret
    return genai.Client(api_key=api_key)


MAX_SIZE = 768
PRIMARY_SESSION = new_session("isnet-general-use")
FALLBACK_SESSION = new_session("u2net")


def normalize_image(source: bytes) -> tuple[bytes, str]:
    with Image.open(io.BytesIO(source)) as opened:
        original = ImageOps.exif_transpose(opened).convert("RGBA")

    try:
        foreground = remove_background_with_rembg(original)
    except ValueError:
        foreground = remove_light_background(original)

    cropped = crop_to_alpha(foreground)

    padding = max(12, round(max(cropped.size) * 0.05))
    available = MAX_SIZE - padding * 2
    cropped.thumbnail((available, available), Image.Resampling.LANCZOS)

    canvas = Image.new(
        "RGBA",
        (cropped.width + padding * 2, cropped.height + padding * 2),
        (0, 0, 0, 0),
    )
    canvas.alpha_composite(cropped, (padding, padding))

    output = io.BytesIO()
    canvas.save(output, format="WEBP", lossless=True, method=6)

    normalized = output.getvalue()
    return normalized, hashlib.sha256(normalized).hexdigest()


def remove_background_with_rembg(image: Image.Image) -> Image.Image:
    result = remove(image, session=PRIMARY_SESSION).convert("RGBA")

    if is_good_cutout(result):
        return result

    fallback = remove(image, session=FALLBACK_SESSION).convert("RGBA")

    if is_good_cutout(fallback):
        return fallback

    raise ValueError("BACKGROUND_REMOVAL_LOW_CONFIDENCE")


def remove_light_background(image: Image.Image) -> Image.Image:
    """
    Good fallback for product photos on white/light gray backgrounds.
    """

    image = image.convert("RGBA")
    rgb = image.convert("RGB")

    # Estimate background color from the image corners
    w, h = rgb.size
    corner_pixels = []

    corner_size = max(20, min(w, h) // 20)

    regions = [
        (0, 0, corner_size, corner_size),
        (w - corner_size, 0, w, corner_size),
        (0, h - corner_size, corner_size, h),
        (w - corner_size, h - corner_size, w, h),
    ]

    for box in regions:
        corner_pixels.extend(list(rgb.crop(box).getdata()))

    bg = tuple(
        sorted(channel)[len(channel) // 2]
        for channel in zip(*corner_pixels)
    )

    pixels = image.load()

    # Higher = more aggressive background removal
    threshold = 42
    soft_edge = 28

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]

            distance = (
                (r - bg[0]) ** 2 +
                (g - bg[1]) ** 2 +
                (b - bg[2]) ** 2
            ) ** 0.5

            if distance < threshold:
                pixels[x, y] = (r, g, b, 0)
            elif distance < threshold + soft_edge:
                alpha = int(255 * (distance - threshold) / soft_edge)
                pixels[x, y] = (r, g, b, min(a, alpha))

    return image


def crop_to_alpha(image: Image.Image) -> Image.Image:
    alpha_box = image.getchannel("A").getbbox()

    if not alpha_box:
        raise ValueError("BACKGROUND_REMOVAL_EMPTY")

    return image.crop(alpha_box)


def is_good_cutout(image: Image.Image) -> bool:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()

    if not bbox:
        return False

    w, h = image.size
    total = w * h

    visible = sum(1 for p in alpha.getdata() if p > 10)
    visible_ratio = visible / total

    if visible_ratio < 0.03:
        return False

    if visible_ratio > 0.90:
        return False

    left, top, right, bottom = bbox
    bbox_ratio = ((right - left) * (bottom - top)) / total

    if bbox_ratio > 0.95:
        return False

    return True


def _parse_jdbc_url(url: str) -> dict[str, str | int]:
    normalized = url.removeprefix("jdbc:")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise ValueError(f"UNSUPPORTED_DATASOURCE_URL_SCHEME:{parsed.scheme}")
    if not parsed.hostname or not parsed.path:
        raise ValueError("INVALID_DATASOURCE_URL")
    return {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "dbname": parsed.path.lstrip("/"),
    }


@lru_cache(maxsize=1)
def postgres_connection_kwargs() -> dict[str, str | int]:
    if DATASOURCE_SECRET_ARN:
        secret = secrets.get_secret_value(SecretId=DATASOURCE_SECRET_ARN)["SecretString"]
        try:
            payload = json.loads(secret)
        except (TypeError, json.JSONDecodeError):
            raise ValueError("INVALID_DATASOURCE_SECRET")
        host = payload.get("host")
        port = payload.get("port", 5432)
        dbname = payload.get("dbname", DATASOURCE_DB_NAME)
        username = payload.get("username")
        password = payload.get("password")
        if not host or not username or password is None:
            raise ValueError("INCOMPLETE_DATASOURCE_SECRET")
        return {
            "host": host,
            "port": int(port),
            "dbname": dbname,
            "user": username,
            "password": password,
            "connect_timeout": 5,
        }

    if DATASOURCE_URL and DATASOURCE_USERNAME and DATASOURCE_PASSWORD is not None:
        parsed = _parse_jdbc_url(DATASOURCE_URL)
        return {
            **parsed,
            "user": DATASOURCE_USERNAME,
            "password": DATASOURCE_PASSWORD,
            "connect_timeout": 5,
        }

    raise ValueError("DATASOURCE_CONFIG_REQUIRED")


@lru_cache(maxsize=1)
def postgres_connection():
    return psycopg2.connect(**postgres_connection_kwargs())


def lookup_reused_metadata(image_hash: str) -> ClothingMetadata | None:
    if not DATASOURCE_SECRET_ARN and not (
        DATASOURCE_URL and DATASOURCE_USERNAME and DATASOURCE_PASSWORD is not None
    ):
        return None

    query = """
        SELECT COALESCE(
            array_agg(ct.tag ORDER BY ct.tag) FILTER (WHERE ct.tag IS NOT NULL),
            ARRAY[]::text[]
        ) AS tags
        FROM clothing_items ci
        LEFT JOIN clothing_tags ct ON ct.clothing_item_id = ci.id
        WHERE ci.image_hash = %s
          AND ci.removed_at IS NULL
          AND ci.image_hash IS NOT NULL
        GROUP BY ci.id, ci.created_at
        ORDER BY ci.created_at ASC
        LIMIT 1
    """
    try:
        with postgres_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, (image_hash,))
                row = cursor.fetchone()
    except psycopg2.Error:
        logger.exception("Unable to look up reused metadata in Postgres")
        try:
            postgres_connection().close()
        except Exception:
            pass
        postgres_connection.cache_clear()
        return None

    if not row:
        return None

    tags = row[0]
    metadata = ClothingMetadata(tags=[])
    metadata.tags = list(dict.fromkeys(
        tag.strip().lower() for tag in (tags or []) if tag and tag.strip()
    ))
    return metadata


class VisionMetadataProvider(Protocol):
    def extract(self, image_bytes: bytes) -> tuple[ClothingMetadata, int, int]: ...


class GeminiVisionMetadataProvider:
    def extract(self, image_bytes: bytes) -> tuple[ClothingMetadata, int, int]:
        prompt = classification_prompt()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        last_error = None
        for _ in range(2):
            try:
                response = gemini_client().models.generate_content(
                    model=MODEL,
                    contents=[prompt, image],
                    config=types.GenerateContentConfig(
                        temperature=0,
                        max_output_tokens=400,
                        response_mime_type="application/json",
                        response_json_schema=ClothingMetadata.model_json_schema(),
                    ),
                )
                metadata = ClothingMetadata.model_validate_json(response.text)
                metadata.tags = list(dict.fromkeys(
                    tag.strip().lower() for tag in metadata.tags if tag.strip()
                ))
                usage = getattr(response, "usage_metadata", None)
                return (
                    metadata,
                    int(getattr(usage, "prompt_token_count", 0) or 0),
                    int(getattr(usage, "candidates_token_count", 0) or 0),
                )
            except (ValidationError, ValueError, TypeError) as exc:
                last_error = exc
        raise ValueError("INVALID_MODEL_OUTPUT") from last_error


class FakeVisionMetadataProvider:
    def extract(self, _image_bytes: bytes) -> tuple[ClothingMetadata, int, int]:
        return (
            ClothingMetadata(
                tags=["t-shirt", "blue", "solid"],
            ),
            0,
            0,
        )


def vision_provider() -> VisionMetadataProvider:
    if PROVIDER == "gemini":
        return GeminiVisionMetadataProvider()
    if PROVIDER == "fake":
        return FakeVisionMetadataProvider()
    raise ValueError(f"UNSUPPORTED_VISION_PROVIDER:{PROVIDER}")


def publish_result(payload: dict):
    sqs.send_message(QueueUrl=RESULT_QUEUE_URL, MessageBody=json.dumps(payload))


def metric(name: str, value: float, unit: str = "Count"):
    if not METRICS_ENABLED:
        logger.info(json.dumps({
            "type": "metric",
            "namespace": "ClosetHop/ImageProcessing",
            "name": name,
            "value": value,
            "unit": unit,
        }))
        return
    cloudwatch.put_metric_data(
        Namespace="ClosetHop/ImageProcessing",
        MetricData=[{"MetricName": name, "Value": value, "Unit": unit}],
    )


def job_from_s3_record(s3_record: dict) -> dict:
    source_key = unquote_plus(s3_record["s3"]["object"]["key"])
    parts = source_key.split("/")
    if len(parts) != 5 or parts[0] != "staging" or parts[4] != "source":
        raise ValueError("INVALID_STAGING_KEY")
    return {
        "userId": parts[1],
        "itemId": parts[2],
        "version": int(parts[3]),
        "sourceKey": source_key,
    }


def jobs_from_s3_event(body: str) -> list[dict]:
    event = json.loads(body)
    records = event.get("Records", [])
    if not records:
        raise ValueError("EXPECTED_S3_RECORDS")
    return [job_from_s3_record(record) for record in records]


def job_from_s3_event(body: str) -> dict:
    jobs = jobs_from_s3_event(body)
    if len(jobs) != 1:
        raise ValueError("EXPECTED_ONE_S3_RECORD")
    return jobs[0]


def failure_result(job: dict, error_code: str) -> dict:
    return {
        "itemId": job["itemId"],
        "version": int(job["version"]),
        "status": "FAILED",
        "objectKey": job["sourceKey"],
        "imageHash": None,
        "metadata": {"tags": []},
        "errorCode": error_code,
    }


def process(job: dict):
    started = time.monotonic()
    item_id = job["itemId"]
    user_id = job["userId"]
    version = int(job["version"])
    source_key = job["sourceKey"]
    output_key = f"users/{user_id}/clothing/{item_id}/{version}/processed.webp"

    source = s3.get_object(Bucket=S3_BUCKET, Key=source_key)["Body"].read()
    normalized, image_hash = normalize_image(source)
    metadata = lookup_reused_metadata(image_hash)
    cache_hit = metadata is not None
    input_tokens = output_tokens = 0
    if metadata is None:
        metadata, input_tokens, output_tokens = vision_provider().extract(normalized)

    s3.put_object(
        Bucket=S3_BUCKET,
        Key=output_key,
        Body=normalized,
        ContentType="image/webp",
        CacheControl="public,max-age=31536000,immutable",
    )
    result = {
            "itemId": item_id,
            "version": version,
            "status": "READY",
            "imageUrl": f"{PUBLIC_URL}/{output_key}",
            "objectKey": output_key,
            "imageHash": image_hash,
            "metadata": metadata.model_dump(mode="json"),
        }
    publish_result(result)
    metric("Processed", 1)
    metric("CacheHit", 1 if cache_hit else 0)
    metric("InputTokens", input_tokens)
    metric("OutputTokens", output_tokens)
    metric("EstimatedVisionCostUSD", input_tokens * 0.10 / 1_000_000 + output_tokens * 0.40 / 1_000_000, "None")
    metric("Latency", (time.monotonic() - started) * 1000, "Milliseconds")


def handler(event, _context):
    failures = []
    for record in event.get("Records", []):
        job = None
        try:
            jobs = jobs_from_s3_event(record["body"])
            for job in jobs:
                process(job)
        except Exception as exc:
            if job is None:
                logger.exception("Discarding malformed S3 notification")
                continue
            error_code = str(exc)
            receive_count = int(record.get("attributes", {}).get("ApproximateReceiveCount", "1"))
            if receive_count < 3:
                failures.append({"itemIdentifier": record["messageId"]})
                continue
            publish_result(failure_result(job, "PROCESSING_FAILED"))
            metric("Failed", 1)
        finally:
            job = None
    return {"batchItemFailures": failures}


def dlq_handler(event, _context):
    failures = []
    for record in event.get("Records", []):
        try:
            for job in jobs_from_s3_event(record["body"]):
                publish_result(failure_result(job, "PROCESSING_FAILED"))
            metric("DlqFailed", 1)
        except Exception:
            logger.exception("Unable to publish terminal result for DLQ message")
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
