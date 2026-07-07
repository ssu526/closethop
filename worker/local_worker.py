import json
import logging
import os
import signal
import time

from app import dlq_handler, handler, sqs


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("closethop.local_worker")
JOB_QUEUE_URL = os.environ["JOB_QUEUE_URL"]
MESSAGE_HANDLER = dlq_handler if os.getenv("DLQ_MODE", "false").lower() == "true" else handler
running = True


def stop(_signal, _frame):
    global running
    running = False


def poll_once() -> int:
    response = sqs.receive_message(
        QueueUrl=JOB_QUEUE_URL,
        MaxNumberOfMessages=1,
        WaitTimeSeconds=10,
        AttributeNames=["ApproximateReceiveCount"],
    )
    messages = response.get("Messages", [])
    for message in messages:
        event = {
            "Records": [{
                "messageId": message["MessageId"],
                "receiptHandle": message["ReceiptHandle"],
                "body": message["Body"],
                "attributes": message.get("Attributes", {}),
            }]
        }
        result = MESSAGE_HANDLER(event, None)
        failures = {
            failure["itemIdentifier"]
            for failure in result.get("batchItemFailures", [])
        }
        if message["MessageId"] not in failures:
            sqs.delete_message(
                QueueUrl=JOB_QUEUE_URL,
                ReceiptHandle=message["ReceiptHandle"],
            )
    return len(messages)


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    logger.info(json.dumps({
        "event": "local_worker_started",
        "queue": JOB_QUEUE_URL,
        "provider": os.getenv("VISION_PROVIDER", "fake"),
    }))
    while running:
        try:
            poll_once()
        except Exception:
            logger.exception("Local worker poll failed")
            time.sleep(2)


if __name__ == "__main__":
    main()
