# ClosetHop

ClosetHop is a wardrobe management app with a React frontend, a Spring Boot API,
and a Python image-processing worker.

## Architecture

Production runs the application stack on Render, with AWS still handling auth,
storage, and async processing.

```mermaid
flowchart LR
  U[User] --> F[Frontend static site]
  F --> B[Spring Boot API on Render]
  B --> P[(Render Postgres)]
  B -->|presigned upload URL| S3[(Private S3 image bucket)]
  F -->|direct PUT| S3
  S3 -->|ObjectCreated original events| Q[SQS processing queue]
  Q --> W[Python worker on Render]
  W --> S3
  W --> P
  F --> C[Cognito hosted auth]
```

Image uploads go directly from the browser to a private S3 bucket using
presigned URLs issued by Spring. S3 ObjectCreated notifications push original
image work to SQS, and the Python worker atomically claims rows in Postgres,
processes images, detects duplicates, and writes final item state directly.

See [`docs/architecture.md`](docs/architecture.md) for the detailed upload
state diagram, failure flows, and cleanup jobs.

## Project Layout

- `frontend/` React + TypeScript UI
- `backend/` Spring Boot HTTP API
- `worker/` Python SQS image-processing worker
- `infrastructure/` AWS CDK app for S3, SQS, and Cognito
- `render.yaml` Render blueprint for the API, worker, and Postgres services

## Prerequisites

- Node.js 20+
- Java 17+
- Docker and Docker Compose
- `npm`

## Production Deployment

### Render services

The active deployment path on `main` uses:

- Render `web` service for the Spring Boot API
- Render `worker` service for the Python image processor
- Render Postgres for the application database
- AWS S3 for image storage
- AWS SQS for async image processing
- AWS Cognito for authentication

The repository root includes [`render.yaml`](render.yaml), which defines the
Render blueprint for the backend services.

### AWS infrastructure via CDK

`main` includes an AWS CDK app under [`infrastructure/`](infrastructure) that
creates the AWS dependencies for the Render-based deployment:

- private S3 image bucket
- SQS processing queue and dead-letter queue
- Cognito user pool, app client, managed login domain, and Google provider

The CDK stack intentionally does **not** configure the S3 bucket notification.
Add the S3 -> SQS event notification manually after deploy if your AWS account
cannot create the helper Lambda that CDK normally uses for bucket-notification
management.

Before deployment, gather:

- `callbackUrl`, for example `https://app.example.com/auth/callback`
- `logoutUrl`, for example `https://app.example.com`
- `googleClientId`
- `googleClientSecret`

Install and synthesize the stack:

```bash
cd infrastructure
npm install
npm run build
npm test
GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID \
GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET \
npx cdk synth \
  -c environmentName=dev \
  -c callbackUrl=https://app.example.com/auth/callback \
  -c logoutUrl=https://app.example.com
```

Deploy with the same context values:

```bash
cd infrastructure
GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID \
GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET \
npx cdk deploy \
  -c environmentName=prod \
  -c callbackUrl=https://app.example.com/auth/callback \
  -c logoutUrl=https://app.example.com
```

If you prefer, you can still pass `googleClientId` and `googleClientSecret`
through `-c`, but environment variables are less likely to leak into shell
history.

The stack outputs the AWS values you need for the Render deployment and any
frontend host, including:

- `ImageBucketName`
- `ProcessingQueueUrl`
- `UserPoolId`
- `UserPoolClientId`
- `CognitoIssuer`
- `CognitoDomain`
- `GoogleOAuthCallbackUrl`
- `ManualS3NotificationEvent`
- `ManualS3NotificationPrefix`

After deploy, configure the S3 event notification manually in AWS:

1. Open the bucket from `ImageBucketName`.
2. Go to `Properties` -> `Event notifications`.
3. Create a notification with:
   - event type `s3:ObjectCreated:*`
   - prefix `users/`
   - destination set to the queue from `ProcessingQueueUrl`

### Render API, worker, and database

1. Create a new Render Blueprint from [`render.yaml`](render.yaml).
2. Let Render provision:
   - `closethop-api`
   - `closethop-worker`
   - `closethop-postgres`
3. When prompted for `sync: false` values, set:
   - `AWS_S3_BUCKET` from `ImageBucketName`
   - `COGNITO_ISSUER` from `CognitoIssuer`
   - `COGNITO_CLIENT_ID` from `UserPoolClientId`
   - `CORS_ALLOWED_ORIGINS`
   - `GEMINI_API_KEY`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `IMAGE_BUCKET` from `ImageBucketName`
   - `PROCESSING_QUEUE_URL` from `ProcessingQueueUrl`

Deployment notes:

- `backend/Dockerfile` accepts Render-style Postgres URLs and normalizes them
  for Spring Boot at startup.
- The current setup is intended to start with one API instance and one worker
  instance.
- The checked-in blueprint uses a free API plan, a starter worker plan, and a
  free Postgres plan. That mix is fine for validation, but not for durable
  production.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` should belong to an IAM
  principal with access to the bucket and processing queue. Google OAuth and
  Gemini values remain manually supplied and are not stored in git.
- Manually configure the S3 event notification after the CDK deploy so uploads
  are sent from S3 to the processing queue.

### Frontend hosting

Deploy `frontend/` as a static site. If you are also hosting the frontend on
Render, create a Static Site pointing at `frontend/` with:

- Build command: `npm install && npm run build`
- Publish directory: `dist`

Set these production environment variables for the frontend:

```dotenv
VITE_API_BASE_URL=https://closethop-api.onrender.com
VITE_AUTH_MODE=cognito
VITE_COGNITO_USER_POOL_ID=<UserPoolId output>
VITE_COGNITO_CLIENT_ID=<UserPoolClientId output>
VITE_COGNITO_DOMAIN=<CognitoDomain output without https://>
VITE_COGNITO_REDIRECT_SIGN_IN=https://app.example.com/auth/callback
VITE_COGNITO_REDIRECT_SIGN_OUT=https://app.example.com
```

Set backend `CORS_ALLOWED_ORIGINS` to the frontend origin.
After the CDK deploy, add the `GoogleOAuthCallbackUrl` output to the Google
OAuth client’s authorized redirect URIs.

## Start Locally

In local development, the app uses Compose-managed Postgres and LocalStack for
S3 and SQS so the full upload pipeline can run without AWS.

1. Start LocalStack, Postgres, and the Python image worker from the backend
   compose file:

   ```bash
   cd backend
   cp .env.example .env
   docker compose up --build
   ```

2. Start the Spring Boot API in a second terminal:

   ```bash
   cd backend
   ./mvnw spring-boot:run -Dspring-boot.run.profiles=local
   ```

3. Optional: if you do not use Docker Compose for the worker, start the Python
   worker manually in a third terminal:

   ```bash
   cd worker
   pip install -r requirements-dev.txt
   AWS_ACCESS_KEY_ID=dummy \
   AWS_SECRET_ACCESS_KEY=dummy \
   AWS_DEFAULT_REGION=us-east-1 \
   AWS_ENDPOINT_URL=http://localhost:4566 \
   DATASOURCE_URL=jdbc:postgresql://localhost:5432/closethop \
   DATASOURCE_USERNAME=closethop \
   DATASOURCE_PASSWORD=closethop \
   IMAGE_BUCKET=closethop-images \
   PROCESSING_QUEUE_URL=http://localhost:4566/000000000000/closethop-image-processing \
   PUBLIC_URL=http://localhost:4566/closethop-images \
   VISION_PROVIDER=fake \
   METRICS_ENABLED=false \
   gunicorn --bind 0.0.0.0:8080 --workers 1 --timeout 180 app:http_app
   ```

4. Start the frontend in another terminal:

   ```bash
   cd frontend
   cp .env.example .env
   npm install
   npm run dev
   ```

5. Open `http://localhost:3000`.

### Local flow

- The frontend talks to the API at `http://localhost:8080` by default.
- Local development uses Postgres from Docker Compose.
- LocalStack provides local S3 and SQS emulation.
- The frontend requests a presigned upload URL from Spring, uploads the image
  directly to S3, then polls Spring for item status.
- The Python worker long-polls the LocalStack SQS queue and updates Postgres
  directly after processing.

### Local verification

Open `http://localhost:3000`, create a local account, and add an item. It
should move from `WAITING_FOR_UPLOAD` to `PROCESSING` to `READY` after the
Python worker handles the S3 event.

## Useful Commands

Frontend:

```bash
cd frontend
npm test
npm run build
```

Local Compose service logs:

```bash
cd backend
docker compose logs -f localstack postgres
```

Manual backend commands:

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

LocalStack inspection:

```bash
cd backend
docker compose exec localstack awslocal s3 ls s3://closethop-images --recursive
```

## Authentication Modes

The frontend supports local auth by default and Cognito in production.

For Cognito mode, set `VITE_AUTH_MODE=cognito` in `frontend/.env` and provide:

- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_DOMAIN`
- Cognito callback and logout URLs if they differ from the localhost defaults

The Cognito user pool must allow the `USER_AUTH` flow and email OTP. Google
sign-in also requires the client configuration and Cognito
`/oauth2/idpresponse` callback.

## Configuration Notes

- `frontend/.env.example` controls the API base URL and auth mode.
- `backend/.env.example` is used by the backend LocalStack/Postgres compose
  setup.
- `infrastructure/` provisions the AWS resources that the Render deployment
  depends on.
- The backend can also run against PostgreSQL and Cognito in production via the
  values documented in `backend/.env.example`.
- Production runs separate API and Python worker containers. The Python worker
  consumes the SQS processing queue, performs image processing and metadata
  extraction, and updates Postgres directly.
