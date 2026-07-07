# ClosetHop frontend

React, TypeScript, and Tailwind CSS frontend for the ClosetHop Spring Boot API.

## Local development

Requirements: Node.js 20+, Java 17+, Docker, and Docker Compose.

Start LocalStack and the image worker. The ready hook creates S3, SQS, and
DynamoDB resources. The worker uses deterministic fake metadata by default:

```bash
cd backend
cp .env.example .env
docker compose up --build
```

Start the backend (H2 data persists in `backend/data/`):

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

In a separate terminal, start the frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`, create a local account, and add an item. It
should move from `PROCESSING` to `READY` after background removal and fake
metadata extraction. The API defaults to `http://localhost:8080`.

To call Gemini instead, set these values in `backend/.env`, then recreate the
worker:

```dotenv
VISION_PROVIDER=gemini
GEMINI_API_KEY=your-key
```

```bash
cd backend
docker compose up -d --build --force-recreate image-worker
```

Inspect processing and LocalStack state with:

```bash
docker compose logs -f image-worker
docker compose exec localstack awslocal sqs list-queues
docker compose exec localstack awslocal dynamodb scan \
  --table-name wardrobe-vision-metadata-cache
docker compose exec localstack awslocal s3 ls s3://closethop-images --recursive
```

## Cognito mode

Copy the Cognito outputs from the CDK stack into `.env`, set `VITE_AUTH_MODE=cognito`, and provide:

- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_DOMAIN` (for example, `example.auth.us-east-1.amazoncognito.com`)
- Cognito callback/logout URLs, if different from the localhost defaults

The Cognito user pool must allow the `USER_AUTH` flow and email OTP. Google also requires its client configuration and Cognito `/oauth2/idpresponse` callback to be configured as described in `infrastructure/README.md`.

## Verification

```bash
npm test
npm run build
```

To test the complete local stack, keep LocalStack, the backend, and the frontend running. Register, upload an image, search/filter the wardrobe, compose an outfit, then restart the backend and confirm H2 records remain.
