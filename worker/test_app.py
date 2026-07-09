import io
import logging
import pytest
from PIL import Image


def test_normalized_image_is_bounded_and_hash_is_stable(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("IMAGE_BUCKET", "images")
    monkeypatch.setenv("PUBLIC_URL", "https://images.example")
    monkeypatch.setenv("GEMINI_SECRET_ARN", "secret")
    import app

    def fake_remove(image, **_kwargs):
        rgba = image.convert("RGBA")
        pixels = rgba.load()
        left = rgba.width // 3
        right = rgba.width * 2 // 3
        top = rgba.height // 3
        bottom = rgba.height * 2 // 3
        for y in range(rgba.height):
            for x in range(rgba.width):
                if left <= x < right and top <= y < bottom:
                    pixels[x, y] = (255, 0, 0, 255)
                else:
                    pixels[x, y] = (255, 0, 0, 0)
        return rgba

    monkeypatch.setattr(app, "remove", fake_remove)
    source = io.BytesIO()
    Image.new("RGB", (1200, 600), "red").save(source, "PNG")
    first, first_hash = app.normalize_image(source.getvalue())
    second, second_hash = app.normalize_image(source.getvalue())

    with Image.open(io.BytesIO(first)) as result:
        assert result.width <= 768
        assert result.height <= 768
    assert first == second
    assert first_hash == second_hash


def test_postgres_lookup_reuses_existing_metadata(monkeypatch):
    import app

    class FakeCursor:
        def __init__(self, row):
            self.row = row
            self.executed = None

        def execute(self, query, params):
            self.executed = (query, params)

        def fetchone(self):
            return self.row

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class FakeConnection:
        def __init__(self, row):
            self.row = row

        def cursor(self):
            return FakeCursor(self.row)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def close(self):
            self.closed = True

    fake_connection = FakeConnection((["Blue", "blue", "solid", None],))
    monkeypatch.setattr(app, "postgres_connection", lambda: fake_connection)
    monkeypatch.setattr(app, "DATASOURCE_URL", "jdbc:postgresql://localhost:5432/closethop")
    monkeypatch.setattr(app, "DATASOURCE_USERNAME", "user")
    monkeypatch.setattr(app, "DATASOURCE_PASSWORD", "pass")

    metadata = app.lookup_reused_metadata("hash")
    assert metadata is not None
    assert metadata.tags == ["blue", "solid"]


def test_fake_provider_returns_valid_deterministic_metadata():
    import app
    first = app.FakeVisionMetadataProvider().extract(b"ignored")
    second = app.FakeVisionMetadataProvider().extract(b"different")
    assert first == second
    assert first[0].tags == ["t-shirt", "blue", "solid"]


def test_classification_prompt_is_loaded_from_file():
    import app
    prompt = app.classification_prompt()
    assert prompt == app.CLASSIFICATION_PROMPT_PATH.read_text().strip()
    assert "Tag Rules" in prompt
    assert "UNKNOWN" not in prompt


def test_metadata_limits_tags():
    import app
    try:
        app.ClothingMetadata(tags=[f"tag-{index}" for index in range(21)])
        assert False, "Expected validation to reject more than 20 tags"
    except app.ValidationError:
        pass


def test_direct_gemini_key_does_not_read_secrets(monkeypatch):
    import app
    sentinel = object()
    monkeypatch.setattr(app, "GEMINI_API_KEY", "direct-key")
    monkeypatch.setattr(app.genai, "Client", lambda api_key: sentinel)
    monkeypatch.setattr(
        app.secrets,
        "get_secret_value",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("secret read")),
    )
    app.gemini_client.cache_clear()
    assert app.gemini_client() is sentinel


def test_process_reuses_postgres_metadata_without_calling_gemini(monkeypatch):
    import app

    source = io.BytesIO()
    Image.new("RGB", (64, 64), "red").save(source, "PNG")
    normalized_bytes = source.getvalue()

    class FakeBody:
        def read(self):
            return normalized_bytes

    class FakeS3:
        def __init__(self):
            self.put_calls = []

        def get_object(self, **_kwargs):
            return {"Body": FakeBody()}

        def put_object(self, **kwargs):
            self.put_calls.append(kwargs)

    fake_s3 = FakeS3()
    monkeypatch.setattr(app, "s3", fake_s3)
    monkeypatch.setattr(app, "metric", lambda *_args: None)
    monkeypatch.setattr(app, "normalize_image", lambda _source: (normalized_bytes, "processed-hash"))
    monkeypatch.setattr(
        app,
        "lookup_reused_metadata",
        lambda _image_hash: app.ClothingMetadata(tags=["blue", "cotton"]),
    )
    monkeypatch.setattr(
        app,
        "vision_provider",
        lambda: (_ for _ in ()).throw(AssertionError("Gemini should not be called")),
    )

    result = app.process({
        "itemId": "item-1",
        "userId": "user-1",
        "sourceKey": "users/user-1/original/item-1.png",
    })

    assert fake_s3.put_calls
    assert result["imageHash"] == "processed-hash"
    assert result["metadata"]["tags"] == ["blue", "cotton"]


def test_process_calls_gemini_when_no_postgres_match(monkeypatch):
    import app

    source = io.BytesIO()
    Image.new("RGB", (64, 64), "red").save(source, "PNG")
    normalized_bytes = source.getvalue()

    class FakeBody:
        def read(self):
            return normalized_bytes

    class FakeS3:
        def __init__(self):
            self.put_calls = []

        def get_object(self, **_kwargs):
            return {"Body": FakeBody()}

        def put_object(self, **kwargs):
            self.put_calls.append(kwargs)

    class FakeProvider:
        def __init__(self):
            self.calls = 0

        def extract(self, _image_bytes):
            self.calls += 1
            return (
                app.ClothingMetadata(tags=["navy"]),
                12,
                3,
            )

    fake_provider = FakeProvider()
    fake_s3 = FakeS3()
    monkeypatch.setattr(app, "s3", fake_s3)
    monkeypatch.setattr(app, "metric", lambda *_args: None)
    monkeypatch.setattr(app, "normalize_image", lambda _source: (normalized_bytes, "processed-hash"))
    monkeypatch.setattr(app, "lookup_reused_metadata", lambda _image_hash: None)
    monkeypatch.setattr(app, "vision_provider", lambda: fake_provider)

    result = app.process({
        "itemId": "item-2",
        "userId": "user-2",
        "sourceKey": "users/user-2/original/item-2.png",
    })

    assert fake_provider.calls == 1
    assert fake_s3.put_calls
    assert result["metadata"]["tags"] == ["navy"]


def test_finalize_deletes_processed_object_when_db_update_fails(monkeypatch):
    import app

    deleted = []

    class FakeS3:
        def delete_object(self, **kwargs):
            deleted.append(kwargs["Key"])

    monkeypatch.setattr(app, "s3", FakeS3())
    monkeypatch.setattr(
        app,
        "process",
        lambda _job: {
            "objectKey": "users/user-1/processed/item-1.webp",
            "imageHash": "processed-hash",
            "metadata": {"tags": ["blue"]},
        },
    )
    monkeypatch.setattr(
        app,
        "ready_with_processed",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("DB_UPDATE_FAILED")),
    )

    with pytest.raises(RuntimeError, match="DB_UPDATE_FAILED"):
        app.finalize_claimed_job({
            "itemId": "item-1",
            "userId": "user-1",
            "sourceKey": "users/user-1/original/item-1.jpg",
        })

    assert deleted == ["users/user-1/processed/item-1.webp"]


def test_parse_original_s3_key_for_direct_upload():
    import app
    job = app.parse_original_key("users/user-1/original/item-1.jpg")
    assert job == {
        "userId": "user-1",
        "itemId": "item-1",
        "sourceKey": "users/user-1/original/item-1.jpg",
    }
    assert app.parse_original_key("users/user-1/processed/item-1.webp") is None


def test_s3_event_parser_ignores_processed_keys():
    import app
    jobs = app.jobs_from_s3_event("""{
      "Records": [
        {"s3": {"object": {"key": "users/user-1/original/item-1.jpg"}}},
        {"s3": {"object": {"key": "users/user-1/processed/item-1.webp"}}}
      ]
    }""")
    assert [job["itemId"] for job in jobs] == ["item-1"]


def test_duplicate_sqs_message_skips_processing(monkeypatch):
    import app
    processed = []
    monkeypatch.setattr(app, "claim_job", lambda _job: None)
    monkeypatch.setattr(app, "finalize_claimed_job", lambda job: processed.append(job))
    app.handle_sqs_message({
        "Body": """{"Records":[{"s3":{"object":{"key":"users/user-1/original/item-1.jpg"}}}]}"""
    })
    assert processed == []


def test_recovers_waiting_uploads_when_original_object_exists(monkeypatch):
    import app

    class FakeCursor:
        def __init__(self):
            self.executed = None

        def execute(self, query, params):
            self.executed = (query, params)

        def fetchall(self):
            return [
                ("item-1", "users/user-1/original/item-1.jpg"),
                ("item-2", "users/user-1/original/item-2.jpg"),
            ]

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class FakeS3:
        def head_object(self, **kwargs):
            if kwargs["Key"].endswith("item-2.jpg"):
                raise RuntimeError("not found")
            return {}

    finalized = []
    monkeypatch.setattr(app, "postgres_connection", lambda: FakeConnection())
    monkeypatch.setattr(app, "s3", FakeS3())
    monkeypatch.setattr(app, "claim_job", lambda job: {"itemId": job["itemId"]})
    monkeypatch.setattr(app, "finalize_claimed_job", lambda job: finalized.append(job))

    assert app.recover_waiting_uploads() == 1
    assert finalized == [{"itemId": "item-1"}]


def test_gemini_key_falls_back_to_secrets_manager(monkeypatch):
    import app
    sentinel = object()
    monkeypatch.setattr(app, "GEMINI_API_KEY", None)
    monkeypatch.setattr(app, "SECRET_ARN", "secret-arn")
    monkeypatch.setattr(app.genai, "Client", lambda api_key: sentinel if api_key == "secret-key" else None)
    monkeypatch.setattr(
        app.secrets,
        "get_secret_value",
        lambda **_kwargs: {"SecretString": '{"apiKey":"secret-key"}'},
    )
    app.gemini_client.cache_clear()
    assert app.gemini_client() is sentinel


def test_metrics_log_when_cloudwatch_is_disabled(monkeypatch, caplog):
    import app
    monkeypatch.setattr(app, "METRICS_ENABLED", False)
    with caplog.at_level(logging.INFO):
        app.metric("CacheHit", 1)
    assert '"name": "CacheHit"' in caplog.text


def test_http_health_returns_ok():
    import app

    client = app.http_app.test_client()
    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"
