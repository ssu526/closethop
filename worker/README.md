# Image worker

Production runs `app.handler` in Lambda. Local development runs
`local_worker.py`, which long-polls LocalStack SQS and invokes the same handler.

Local configuration is provided by `backend/compose.yml`. Supported vision
providers:

- `fake`: deterministic, free metadata for pipeline testing.
- `gemini`: Gemini 2.5 Flash-Lite using `GEMINI_API_KEY`.

CloudWatch calls are disabled locally and emitted as structured log records.
Production continues reading the Gemini key from Secrets Manager and publishing
CloudWatch custom metrics. In production, the worker also consults Postgres for
previously processed image hashes so repeated images can reuse existing
metadata without a Gemini call.
