import hashlib
import io
import json
import logging
import os
import gc
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote_plus, urlparse

import boto3
from flask import Flask, jsonify
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


S3_BUCKET = os.getenv("IMAGE_BUCKET") or os.getenv("AWS_S3_BUCKET")
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
PROCESSING_QUEUE_URL = os.getenv("PROCESSING_QUEUE_URL")
MODEL = os.getenv("VISION_MODEL", "gemini-2.5-flash-lite")
PROVIDER = os.getenv("VISION_PROVIDER", "gemini")
AWS_ENDPOINT_URL = os.getenv("AWS_ENDPOINT_URL") or None
DATASOURCE_SECRET_ARN = os.getenv("DATASOURCE_SECRET_ARN")
DATASOURCE_URL = os.getenv("DATASOURCE_URL")
DATASOURCE_USERNAME = os.getenv("DATASOURCE_USERNAME")
DATASOURCE_PASSWORD = os.getenv("DATASOURCE_PASSWORD")
DATASOURCE_DB_NAME = os.getenv("DATASOURCE_DB_NAME", "closethop")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
SECRET_ARN = os.getenv("GEMINI_SECRET_ARN")
METRICS_ENABLED = os.getenv("METRICS_ENABLED", "true").lower() == "true"
WORKER_CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "1"))
SQS_MAX_MESSAGES = int(os.getenv("SQS_MAX_MESSAGES", "1"))
SQS_WAIT_TIME_SECONDS = int(os.getenv("SQS_WAIT_TIME_SECONDS", "20"))
SQS_VISIBILITY_TIMEOUT_SECONDS = int(os.getenv("SQS_VISIBILITY_TIMEOUT_SECONDS", "300"))
PROCESSING_DEADLINE_SECONDS = int(os.getenv("PROCESSING_DEADLINE_SECONDS", "30"))
GEMINI_RETRY_ATTEMPTS = int(os.getenv("GEMINI_RETRY_ATTEMPTS", "3"))
PROCESSED_UPLOAD_RETRY_ATTEMPTS = int(os.getenv("PROCESSED_UPLOAD_RETRY_ATTEMPTS", "3"))
CLASSIFICATION_PROMPT_PATH = Path(os.getenv(
    "CLASSIFICATION_PROMPT_PATH",
    Path(__file__).resolve().parent / "prompts" / "clothing_classifier_prompt.txt",
))
HTTP_HOST = os.getenv("HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8080"))

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
MAX_SOURCE_EDGE = int(os.getenv("MAX_SOURCE_EDGE", "1600"))
REMBG_SESSION_CACHE_MODE = os.getenv("REMBG_SESSION_CACHE_MODE", "none").lower()
BACKGROUND_REMOVAL_MODE = os.getenv("BACKGROUND_REMOVAL_MODE", "hybrid").lower()


@lru_cache(maxsize=2)
def _cached_rembg_session(model_name: str):
    return new_session(model_name)


def rembg_session(model_name: str):
    if REMBG_SESSION_CACHE_MODE == "all":
        return _cached_rembg_session(model_name)
    if REMBG_SESSION_CACHE_MODE == "primary" and model_name == "isnet-general-use":
        return _cached_rembg_session(model_name)
    return new_session(model_name)


def downscale_for_processing(image: Image.Image) -> Image.Image:
    if max(image.size) <= MAX_SOURCE_EDGE:
        return image
    resized = image.copy()
    resized.thumbnail((MAX_SOURCE_EDGE, MAX_SOURCE_EDGE), Image.Resampling.LANCZOS)
    return resized


def normalize_image(source: bytes) -> tuple[bytes, str]:
    with Image.open(io.BytesIO(source)) as opened:
        original = downscale_for_processing(ImageOps.exif_transpose(opened).convert("RGBA"))

    foreground = remove_background(original)

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


def remove_background(image: Image.Image) -> Image.Image:
    if BACKGROUND_REMOVAL_MODE == "light_only":
        return remove_light_background(image)
    if BACKGROUND_REMOVAL_MODE == "rembg_only":
        return remove_background_with_rembg(image)
    if BACKGROUND_REMOVAL_MODE == "hybrid":
        try:
            return remove_background_with_rembg(image)
        except ValueError:
            return remove_light_background(image)
    raise ValueError(f"UNSUPPORTED_BACKGROUND_REMOVAL_MODE:{BACKGROUND_REMOVAL_MODE}")


def remove_background_with_rembg(image: Image.Image) -> Image.Image:
    session = rembg_session("isnet-general-use")
    result = remove(image, session=session).convert("RGBA")
    del session

    if is_good_cutout(result):
        return result

    gc.collect()
    fallback_session = rembg_session("u2net")
    fallback = remove(image, session=fallback_session).convert("RGBA")
    del fallback_session

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


def parse_original_key(source_key: str) -> dict | None:
    parts = source_key.split("/")
    if len(parts) != 4 or parts[0] != "users" or parts[2] != "original":
        return None
    filename = parts[3]
    if "." not in filename:
        return None
    item_id = filename.rsplit(".", 1)[0]
    return {
        "userId": parts[1],
        "itemId": item_id,
        "sourceKey": source_key,
    }


def jobs_from_s3_event(body: str) -> list[dict]:
    event = json.loads(body)
    if isinstance(event, dict) and isinstance(event.get("Message"), str):
        event = json.loads(event["Message"])
    if event.get("Event") == "s3:TestEvent":
        return []
    jobs = []
    for record in event.get("Records", []):
        raw_key = record.get("s3", {}).get("object", {}).get("key")
        if not raw_key:
            continue
        job = parse_original_key(unquote_plus(raw_key))
        if job:
            jobs.append(job)
    return jobs


def claim_job(job: dict) -> dict | None:
    query = """
        UPDATE clothing_items
        SET processing_status = 'PROCESSING',
            uploaded_at = COALESCE(uploaded_at, now()),
            processing_started_at = now(),
            processing_deadline_at = now() + (%s * interval '1 second'),
            processing_error = NULL
        WHERE id = %s
          AND processing_status = 'WAITING_FOR_UPLOAD'
        RETURNING id, user_id, original_s3_key
    """
    with postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (PROCESSING_DEADLINE_SECONDS, job["itemId"]))
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "itemId": str(row[0]),
                "userId": str(row[1]),
                "sourceKey": row[2],
            }


def recover_waiting_uploads(limit: int = 10) -> int:
    if not S3_BUCKET:
        raise ValueError("IMAGE_BUCKET_REQUIRED")
    query = """
        SELECT id, original_s3_key
        FROM clothing_items
        WHERE processing_status = 'WAITING_FOR_UPLOAD'
          AND original_s3_key IS NOT NULL
          AND removed_at IS NULL
        ORDER BY created_at ASC
        LIMIT %s
    """
    with postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (limit,))
            rows = cursor.fetchall()

    recovered = 0
    for item_id, source_key in rows:
        try:
            s3.head_object(Bucket=S3_BUCKET, Key=source_key)
        except Exception:
            continue
        claimed = claim_job({"itemId": str(item_id)})
        if not claimed:
            continue
        logger.info("Recovered uploaded item %s without an SQS event", item_id)
        finalize_claimed_job(claimed)
        recovered += 1
    return recovered


def ready_with_original(item_id: str, error_code: str):
    query = """
        UPDATE clothing_items
        SET processing_status = 'READY',
            processed_s3_key = NULL,
            processing_error = %s,
            processing_deadline_at = NULL,
            processed_at = now()
        WHERE id = %s
    """
    with postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (error_code, item_id))


def ready_with_processed(job: dict, processed_key: str, image_hash: str, metadata: ClothingMetadata):
    duplicate_query = """
        SELECT id
        FROM clothing_items
        WHERE user_id = %s
          AND id <> %s
          AND image_hash = %s
          AND processing_status = 'READY'
          AND removed_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
    """
    reject_query = """
        UPDATE clothing_items
        SET processing_status = 'DUPLICATE_REJECTED',
            processed_s3_key = NULL,
            image_hash = %s,
            duplicate_of_id = %s,
            processing_error = 'DUPLICATE_UPLOAD',
            processing_deadline_at = NULL,
            processed_at = now(),
            original_deleted_at = now()
        WHERE id = %s
    """
    ready_query = """
        UPDATE clothing_items
        SET processing_status = 'READY',
            processed_s3_key = %s,
            image_hash = %s,
            processing_error = NULL,
            processing_deadline_at = NULL,
            processed_at = now(),
            duplicate_of_id = NULL
        WHERE id = %s
    """
    delete_tags = "DELETE FROM clothing_tags WHERE clothing_item_id = %s"
    insert_tag = "INSERT INTO clothing_tags (clothing_item_id, tag) VALUES (%s, %s)"
    with postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(duplicate_query, (job["userId"], job["itemId"], image_hash))
            duplicate = cursor.fetchone()
            if duplicate:
                cursor.execute(reject_query, (image_hash, duplicate[0], job["itemId"]))
                return {"status": "DUPLICATE_REJECTED", "duplicateOfId": str(duplicate[0])}
            cursor.execute(ready_query, (processed_key, image_hash, job["itemId"]))
            cursor.execute(delete_tags, (job["itemId"],))
            for tag in metadata.tags:
                cursor.execute(insert_tag, (job["itemId"], tag))
            return {"status": "READY"}


def mark_failed(item_id: str, error_code: str):
    query = """
        UPDATE clothing_items
        SET processing_status = 'FAILED',
            processed_s3_key = NULL,
            processing_error = %s,
            processing_deadline_at = NULL,
            processed_at = now()
        WHERE id = %s
    """
    with postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (error_code, item_id))


def record_original_deleted(item_id: str):
    query = "UPDATE clothing_items SET original_deleted_at = now() WHERE id = %s"
    with postgres_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (item_id,))


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
    try:
        cloudwatch.put_metric_data(
            Namespace="ClosetHop/ImageProcessing",
            MetricData=[{"MetricName": name, "Value": value, "Unit": unit}],
        )
    except Exception:
        logger.exception("Unable to publish CloudWatch metric %s", name)


def build_public_url(output_key: str) -> str:
    if not PUBLIC_URL:
        return output_key
    return f"{PUBLIC_URL}/{output_key}"


def process(job: dict) -> dict:
    if not S3_BUCKET:
        raise ValueError("IMAGE_BUCKET_REQUIRED")
    started = time.monotonic()
    item_id = job["itemId"]
    user_id = job["userId"]
    source_key = job["sourceKey"]
    output_key = f"users/{user_id}/processed/{item_id}.webp"

    source = s3.get_object(Bucket=S3_BUCKET, Key=source_key)["Body"].read()
    normalized, image_hash = normalize_image(source)
    metadata = lookup_reused_metadata(image_hash)
    cache_hit = metadata is not None
    input_tokens = output_tokens = 0
    if metadata is None:
        metadata, input_tokens, output_tokens = extract_metadata_with_fallback(normalized)

    put_processed_with_retry(output_key, normalized)
    result = {
        "itemId": item_id,
        "status": "READY",
        "imageUrl": build_public_url(output_key),
        "objectKey": output_key,
        "imageHash": image_hash,
        "metadata": metadata.model_dump(mode="json"),
    }
    metric("Processed", 1)
    metric("CacheHit", 1 if cache_hit else 0)
    metric("InputTokens", input_tokens)
    metric("OutputTokens", output_tokens)
    metric("EstimatedVisionCostUSD", input_tokens * 0.10 / 1_000_000 + output_tokens * 0.40 / 1_000_000, "None")
    metric("Latency", (time.monotonic() - started) * 1000, "Milliseconds")
    return result


def extract_metadata_with_fallback(image_bytes: bytes) -> tuple[ClothingMetadata, int, int]:
    last_error = None
    for _ in range(max(1, GEMINI_RETRY_ATTEMPTS)):
        try:
            return vision_provider().extract(image_bytes)
        except Exception as exc:
            last_error = exc
            logger.warning("Gemini classification failed; retrying if attempts remain: %s", exc)
    logger.warning("Gemini classification failed permanently; continuing without tags: %s", last_error)
    return ClothingMetadata(tags=[]), 0, 0


def put_processed_with_retry(output_key: str, normalized: bytes):
    last_error = None
    for _ in range(max(1, PROCESSED_UPLOAD_RETRY_ATTEMPTS)):
        try:
            s3.put_object(
                Bucket=S3_BUCKET,
                Key=output_key,
                Body=normalized,
                ContentType="image/webp",
                CacheControl="public,max-age=31536000,immutable",
            )
            return
        except Exception as exc:
            last_error = exc
            logger.warning("Processed image upload failed; retrying if attempts remain: %s", exc)
    raise RuntimeError("PROCESSED_UPLOAD_FAILED") from last_error


def finalize_claimed_job(job: dict):
    processed_key = None
    try:
        result = process(job)
        processed_key = result["objectKey"]
    except ValueError as exc:
        logger.warning("Background removal failed for item %s; using original: %s", job["itemId"], exc)
        ready_with_original(job["itemId"], "BACKGROUND_REMOVAL_FAILED_USING_ORIGINAL")
        return
    except RuntimeError as exc:
        if str(exc) == "PROCESSED_UPLOAD_FAILED":
            logger.warning("Processed upload failed for item %s; using original", job["itemId"])
            ready_with_original(job["itemId"], "PROCESSED_UPLOAD_FAILED_USING_ORIGINAL")
            return
        raise

    metadata = ClothingMetadata.model_validate(result.get("metadata") or {"tags": []})
    try:
        outcome = ready_with_processed(job, processed_key, result["imageHash"], metadata)
    except Exception:
        if processed_key:
            delete_object_quietly(processed_key)
        raise
    if outcome["status"] == "DUPLICATE_REJECTED":
        delete_object_quietly(job["sourceKey"])
        if processed_key:
            delete_object_quietly(processed_key)
        return
    try:
        s3.delete_object(Bucket=S3_BUCKET, Key=job["sourceKey"])
        record_original_deleted(job["itemId"])
    except Exception:
        logger.exception("Unable to delete original image %s after successful processing", job["sourceKey"])


def delete_object_quietly(key: str):
    try:
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
    except Exception:
        logger.warning("Unable to delete S3 object %s", key, exc_info=True)


def handle_sqs_message(message: dict):
    jobs = jobs_from_s3_event(message.get("Body", ""))
    for job in jobs:
        claimed = claim_job(job)
        if not claimed:
            logger.info("Skipping duplicate or stale upload event for %s", job.get("itemId"))
            continue
        finalize_claimed_job(claimed)


def run_worker():
    if not S3_BUCKET:
        raise ValueError("IMAGE_BUCKET_REQUIRED")
    if not PROCESSING_QUEUE_URL:
        raise ValueError("PROCESSING_QUEUE_URL_REQUIRED")
    while True:
        response = sqs.receive_message(
            QueueUrl=PROCESSING_QUEUE_URL,
            MaxNumberOfMessages=SQS_MAX_MESSAGES,
            WaitTimeSeconds=SQS_WAIT_TIME_SECONDS,
            VisibilityTimeout=SQS_VISIBILITY_TIMEOUT_SECONDS,
        )
        for message in response.get("Messages", []):
            try:
                handle_sqs_message(message)
                sqs.delete_message(
                    QueueUrl=PROCESSING_QUEUE_URL,
                    ReceiptHandle=message["ReceiptHandle"],
                )
            except Exception:
                logger.exception("Unable to process SQS message %s", message.get("MessageId"))
        try:
            recover_waiting_uploads()
        except Exception:
            logger.exception("Unable to recover waiting uploads")


_worker_thread_started = False


def start_background_worker():
    global _worker_thread_started
    if _worker_thread_started:
        return
    if not PROCESSING_QUEUE_URL:
        return
    if os.getenv("START_SQS_WORKER", "true").lower() != "true":
        return
    threading.Thread(target=run_worker, daemon=True).start()
    _worker_thread_started = True


http_app = Flask(__name__)


@http_app.get("/health")
def health():
    return jsonify({"status": "ok"})


start_background_worker()


if __name__ == "__main__":
    http_app.run(host=HTTP_HOST, port=HTTP_PORT)
