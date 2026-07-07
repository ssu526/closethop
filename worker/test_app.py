import io
import logging
import json
import uuid
from PIL import Image


def test_normalized_image_is_bounded_and_hash_is_stable(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("IMAGE_BUCKET", "images")
    monkeypatch.setenv("RESULT_QUEUE_URL", "results")
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
    published = []
    monkeypatch.setattr(app, "s3", fake_s3)
    monkeypatch.setattr(app, "publish_result", published.append)
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

    app.process({
        "itemId": "item-1",
        "userId": "user-1",
        "version": 1,
        "sourceKey": "staging/user-1/item-1/1/source",
    })

    assert fake_s3.put_calls
    assert published[0]["imageHash"] == "processed-hash"
    assert published[0]["metadata"]["tags"] == ["blue", "cotton"]


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
    published = []
    monkeypatch.setattr(app, "s3", fake_s3)
    monkeypatch.setattr(app, "publish_result", published.append)
    monkeypatch.setattr(app, "metric", lambda *_args: None)
    monkeypatch.setattr(app, "normalize_image", lambda _source: (normalized_bytes, "processed-hash"))
    monkeypatch.setattr(app, "lookup_reused_metadata", lambda _image_hash: None)
    monkeypatch.setattr(app, "vision_provider", lambda: fake_provider)

    app.process({
        "itemId": "item-2",
        "userId": "user-2",
        "version": 1,
        "sourceKey": "staging/user-2/item-2/1/source",
    })

    assert fake_provider.calls == 1
    assert fake_s3.put_calls
    assert published[0]["metadata"]["tags"] == ["navy"]


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


def test_local_poller_deletes_acknowledged_message(monkeypatch):
    monkeypatch.setenv("JOB_QUEUE_URL", "jobs")
    import local_worker

    class FakeSqs:
        deleted = False

        def receive_message(self, **_kwargs):
            return {"Messages": [{
                "MessageId": "message-1",
                "ReceiptHandle": "receipt",
                "Body": "{}",
                "Attributes": {"ApproximateReceiveCount": "1"},
            }]}

        def delete_message(self, **_kwargs):
            self.deleted = True

    fake_sqs = FakeSqs()
    monkeypatch.setattr(local_worker, "sqs", fake_sqs)
    monkeypatch.setattr(local_worker, "handler", lambda *_args: {"batchItemFailures": []})
    assert local_worker.poll_once() == 1
    assert fake_sqs.deleted


def test_local_poller_leaves_failed_message_for_retry(monkeypatch):
    import local_worker

    class FakeSqs:
        deleted = False

        def receive_message(self, **_kwargs):
            return {"Messages": [{
                "MessageId": "message-2",
                "ReceiptHandle": "receipt",
                "Body": "{}",
                "Attributes": {"ApproximateReceiveCount": "1"},
            }]}

        def delete_message(self, **_kwargs):
            self.deleted = True

    fake_sqs = FakeSqs()
    monkeypatch.setattr(local_worker, "sqs", fake_sqs)
    monkeypatch.setattr(
        local_worker,
        "MESSAGE_HANDLER",
        lambda *_args: {"batchItemFailures": [{"itemIdentifier": "message-2"}]},
    )
    assert local_worker.poll_once() == 1
    assert not fake_sqs.deleted


def s3_message(receive_count="1"):
    user_id = str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    body = json.dumps({"Records": [{"s3": {"object": {
        "key": f"staging/{user_id}/{item_id}/1/source"
    }}}]})
    return {
        "messageId": "message",
        "body": body,
        "attributes": {"ApproximateReceiveCount": receive_count},
    }, user_id, item_id


def s3_message_with_multiple_records():
    first_user_id = str(uuid.uuid4())
    first_item_id = str(uuid.uuid4())
    second_user_id = str(uuid.uuid4())
    second_item_id = str(uuid.uuid4())
    body = json.dumps({"Records": [
        {"s3": {"object": {"key": f"staging/{first_user_id}/{first_item_id}/1/source"}}},
        {"s3": {"object": {"key": f"staging/{second_user_id}/{second_item_id}/2/source"}}},
    ]})
    return {
        "messageId": "message-multi",
        "body": body,
        "attributes": {"ApproximateReceiveCount": "1"},
    }, [
        {
            "userId": first_user_id,
            "itemId": first_item_id,
            "version": 1,
            "sourceKey": f"staging/{first_user_id}/{first_item_id}/1/source",
        },
        {
            "userId": second_user_id,
            "itemId": second_item_id,
            "version": 2,
            "sourceKey": f"staging/{second_user_id}/{second_item_id}/2/source",
        },
    ]


def test_s3_notification_is_parsed_into_versioned_job():
    import app
    record, user_id, item_id = s3_message()
    job = app.job_from_s3_event(record["body"])
    assert job == {
        "userId": user_id,
        "itemId": item_id,
        "version": 1,
        "sourceKey": f"staging/{user_id}/{item_id}/1/source",
    }


def test_s3_notification_with_multiple_records_is_split_into_jobs():
    import app
    record, jobs = s3_message_with_multiple_records()
    assert app.jobs_from_s3_event(record["body"]) == jobs


def test_worker_retries_first_two_failures_and_reports_third(monkeypatch):
    import app
    monkeypatch.setattr(app, "process", lambda _job: (_ for _ in ()).throw(RuntimeError("boom")))
    published = []
    monkeypatch.setattr(app, "publish_result", published.append)
    monkeypatch.setattr(app, "metric", lambda *_args: None)

    first, _, _ = s3_message("1")
    second, _, _ = s3_message("2")
    third, _, _ = s3_message("3")
    assert app.handler({"Records": [first]}, None)["batchItemFailures"]
    assert app.handler({"Records": [second]}, None)["batchItemFailures"]
    assert app.handler({"Records": [third]}, None)["batchItemFailures"] == []
    assert published[-1]["errorCode"] == "PROCESSING_FAILED"


def test_worker_processes_all_s3_records_in_one_message(monkeypatch):
    import app
    processed = []
    monkeypatch.setattr(app, "process", processed.append)

    record, jobs = s3_message_with_multiple_records()
    assert app.handler({"Records": [record]}, None)["batchItemFailures"] == []
    assert processed == jobs


def test_dlq_consumer_sends_terminal_fallback_result(monkeypatch):
    import app
    published = []
    monkeypatch.setattr(app, "publish_result", published.append)
    monkeypatch.setattr(app, "metric", lambda *_args: None)
    record, _, _ = s3_message("1")
    assert app.dlq_handler({"Records": [record]}, None)["batchItemFailures"] == []
    assert published[0]["status"] == "FAILED"


def test_dlq_consumer_sends_fallback_for_each_s3_record_in_message(monkeypatch):
    import app
    published = []
    monkeypatch.setattr(app, "publish_result", published.append)
    monkeypatch.setattr(app, "metric", lambda *_args: None)

    record, jobs = s3_message_with_multiple_records()
    assert app.dlq_handler({"Records": [record]}, None)["batchItemFailures"] == []
    assert [result["itemId"] for result in published] == [job["itemId"] for job in jobs]
