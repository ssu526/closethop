# AGENTS.md

Use this as the quick repo guide for Codex and other coding agents. Keep it short and update it when commands, architecture, or conventions change.

## Project Shape

- ClosetHop is a wardrobe app with three main parts:
  - `frontend/`: React 18 + TypeScript + Vite + Tailwind.
  - `backend/`: Java 17 Spring Boot API with JPA, Flyway, Postgres, S3, SQS, and Cognito integration.
  - `worker/`: Python image-processing worker that consumes SQS, talks to S3/Postgres, removes backgrounds, normalizes images, and extracts clothing tags.
- Production is Render for the API, worker, and Postgres; AWS still provides S3, SQS, and Cognito. See `README.md` and `docs/architecture.md` for the full flow.
- The active deployment config is `render.yaml`. Do not revive legacy EC2/CDK/deploy paths unless explicitly requested.

## Common Commands

Frontend:

```bash
cd frontend
npm install
npm run dev
npm test
npm run build
```

Backend:

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
./mvnw test
```

Local infrastructure and worker:

```bash
cd backend
cp .env.example .env
docker compose up --build
docker compose logs -f localstack postgres python-worker
```

Worker tests:

```bash
cd worker
pip install -r requirements-dev.txt
pytest
```

## Local Development Notes

- Local development uses `backend/compose.yml` for Postgres, LocalStack S3/SQS, and the Python worker.
- The frontend usually runs on `http://localhost:3000` and talks to the backend at `http://localhost:8080`.
- Use `frontend/.env.example` and `backend/.env.example` as templates. Do not commit real secrets from `.env` files.
- Browser uploads go directly to S3 through presigned URLs from the backend. S3 ObjectCreated events enqueue original image processing work to SQS.

## Implementation Conventions

- Prefer existing service/controller/repository layering in `backend/src/main/java/com/wardrobe`.
- Add schema changes as new Flyway migrations under `backend/src/main/resources/db/migration`; do not edit old migrations unless the user specifically asks.
- Keep DTO/API changes aligned between `backend/src/main/java/com/wardrobe/dto` and `frontend/src/lib/api.ts` / `frontend/src/types.ts`.
- Frontend UI uses existing shared components in `frontend/src/components/ui.tsx`, Tailwind utility classes, and lucide-react icons.
- Worker metadata extraction behavior lives in `worker/app.py`; the classifier prompt lives in `worker/prompts/clothing_classifier_prompt.txt`.

## Testing Guidance

- For frontend changes, run `npm test`; run `npm run build` when touching routing, build config, types, or shared API/types.
- For backend changes, run `./mvnw test`; integration tests may require Docker.
- For worker changes, run `pytest` from `worker/`.
- If a command cannot be run because dependencies, Docker, or network access are unavailable, report that clearly.

## Important Domain Rules

- Image lifecycle states and recovery behavior are documented in `docs/architecture.md`; consult it before changing upload, processing, cleanup, or display-image logic.
- Display image selection is derived from `processed_s3_key`, then available `original_s3_key`; avoid reintroducing a generic stored image URL.
- Duplicate uploads are detected per user by normalized image hash and should preserve the existing ready item as canonical.
- The worker should delete SQS messages only after successful handling or confirmed duplicate/stale handling.
