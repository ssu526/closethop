# ClosetHop

ClosetHop is a wardrobe management app with a React frontend, a Spring Boot API,
and a Python image-processing worker. 

## Architecture

Production splits responsibilities between a Vercel-hosted frontend, an EC2
app host running Docker Compose, and managed AWS services for auth, storage,
queues, async processing, and backups.

```mermaid
flowchart LR
  U[User] --> V[Vercel frontend<br/>React]
  V -->|/api rewrite| N[nginx on EC2]
  N --> B[Spring Boot container]
  B --> P[(Postgres on EBS)]
  B --> S3[(Private S3 image bucket)]
  S3 -->|staging upload events| Q[SQS processing queue]
  Q --> L[Lambda image worker]
  L --> S3
  L --> R[SQS result queue]
  B -->|polls results| R
  BK[pg_dump backup job] --> BS3[(S3 backup bucket)]
  V --> C[Cognito hosted auth]
```

Production request flow starts in Vercel, where `/api/*` is rewritten to nginx
on a single EC2 instance. nginx proxies requests to the Spring Boot container,
which uses a Postgres container persisted on EBS.

Image uploads land in a private S3 bucket under a staging prefix. S3 event
notifications push work to SQS, a Lambda image worker processes the image, and
the backend polls the result queue to finalize wardrobe state. A scheduled
backup job writes Postgres dumps to a separate S3 backup bucket.


## Project Layout

- `frontend/` React + TypeScript UI
- `backend/` Spring Boot API, auth, persistence, and local compose stack
- `worker/` Python image-processing worker
- `infrastructure/` AWS CDK infrastructure for production
- `deploy/ec2/` EC2 deployment configuration, including the production app stack
  in [`deploy/ec2/compose.prod.yml`](deploy/ec2/compose.prod.yml)

## Prerequisites

- Node.js 20+
- Java 17+
- Docker and Docker Compose
- `npm`

## Production Deployment

### AWS prerequisites

1. Configure an AWS account and bootstrap the target account/region with CDK.
2. Create Google OAuth web credentials.
3. Create the OAuth and Gemini secrets expected by the stack:

   ```bash
   aws secretsmanager create-secret \
     --name closethop/dev/google-oauth \
     --secret-string '{"clientId":"GOOGLE_CLIENT_ID","clientSecret":"GOOGLE_CLIENT_SECRET"}'

   aws secretsmanager create-secret \
     --name closethop/dev/gemini \
     --secret-string '{"apiKey":"GEMINI_API_KEY"}'
   ```

After the first deployment, add the `GoogleOAuthCallbackUrl` stack output to
the authorized redirect URIs in Google Cloud Console.

### Validate and synthesize infrastructure

```bash
cd infrastructure
npm install
npm test
npm run build
npm run synth
```

Override configuration with CDK context:

```bash
cd infrastructure
npx cdk synth \
  -c callbackUrl=https://app.example.com/auth/callback \
  -c logoutUrl=https://app.example.com \
  -c googleSecretName=closethop/dev/google-oauth \
  -c geminiSecretName=closethop/dev/gemini \
  -c alertEmail=alerts@example.com
```

`alertEmail` is optional. When provided, the stack creates an SNS topic,
subscribes the email address, and routes CloudWatch alarm notifications to it.
The subscription remains pending until the recipient confirms the AWS email.

### EC2 deployment

The EC2 instance is reachable through AWS Systems Manager Session Manager; SSH
is not opened by the stack. After CDK deploy finishes, connect to the instance
and install the app:

```bash
sudo mkdir -p /opt/closethop
sudo chown ec2-user:ec2-user /opt/closethop
cd /opt/closethop
git clone https://github.com/YOUR_ORG/YOUR_REPO.git repo
cd repo/deploy/ec2
cp .env.example .env
```

Edit `.env` using stack outputs:

- `AWS_S3_BUCKET` from `ImageBucketName`
- `BACKUP_BUCKET` from `DatabaseBackupBucketName`
- `PROCESSING_RESULT_QUEUE_URL` from `ProcessingResultQueueUrl`
- `COGNITO_ISSUER` from `CognitoIssuer`
- `COGNITO_CLIENT_ID` from `UserPoolClientId`
- `CORS_ALLOWED_ORIGINS` set to the Vercel app origin
- `POSTGRES_PASSWORD` set to a long random value
- `GEMINI_API_KEY` set to the Gemini API key used by the backend outfit AI

Start the production Compose stack:

```bash
docker compose --env-file .env -f compose.prod.yml up -d --build
docker compose --env-file .env -f compose.prod.yml ps
curl http://localhost/health
```

The nginx container listens on ports 80 and 443. It creates a short-lived
self-signed certificate on first boot so 443 is available immediately. Replace
`deploy/ec2/certs/fullchain.pem` and `deploy/ec2/certs/privkey.pem` with
Let's Encrypt or managed proxy certificates before treating HTTPS as production
trusted.

### Backups and restore

Install the nightly Postgres backup cron:

```bash
cd deploy/ec2
chmod +x install-backup-cron.sh
./install-backup-cron.sh
```

Run a manual backup:

```bash
cd deploy/ec2
docker compose --env-file .env -f compose.prod.yml --profile backup run --rm backup
```

Restore a backup:

```bash
aws s3 cp s3://$BACKUP_BUCKET/postgres/closethop-YYYYMMDDTHHMMSSZ.dump /data/closethop/backups/restore.dump
docker compose --env-file .env -f compose.prod.yml exec postgres \
  pg_restore --clean --if-exists --no-owner \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  /backups/restore.dump
```

### Vercel configuration

Set these production environment variables in Vercel:

```dotenv
API_ORIGIN=http://EC2_PUBLIC_DNS_NAME
VITE_API_BASE_URL=/
VITE_AUTH_MODE=cognito
VITE_COGNITO_USER_POOL_ID=us-east-1_example
VITE_COGNITO_CLIENT_ID=exampleclientid
VITE_COGNITO_DOMAIN=closethop-dev-123456789012.auth.us-east-1.amazoncognito.com
VITE_COGNITO_REDIRECT_SIGN_IN=https://app.example.com/auth/callback
VITE_COGNITO_REDIRECT_SIGN_OUT=https://app.example.com
```

`frontend/vercel.json` sends `/api/*` to the EC2 nginx origin first and falls
back to `index.html` for client-side routes.


## Start Locally
In local development, the app uses H2 for the backend database and LocalStack for S3 and SQS so the full upload pipeline can run without AWS.


1. Start LocalStack and the image worker from the backend compose file:

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

3. Start the frontend in a third terminal:

   ```bash
   cd frontend
   cp .env.example .env
   npm install
   npm run dev
   ```

4. Open `http://localhost:3000`.

### Local flow

- The frontend talks to the API at `http://localhost:8080` by default.
- Local development uses H2 data stored under `backend/data/`.
- LocalStack provides local S3 and SQS emulation.
- The local worker long-polls the LocalStack SQS queue and uses the same core
  handler as production.

### Local image processing modes

The worker supports two vision providers:

- `fake`: deterministic metadata for free local pipeline testing
- `gemini`: Gemini 2.5 Flash-Lite using `GEMINI_API_KEY`

To call Gemini locally, set these values in `backend/.env`, then recreate the
worker:

```dotenv
VISION_PROVIDER=gemini
GEMINI_API_KEY=your-key
```

```bash
cd backend
docker compose up -d --build --force-recreate image-worker
```

CloudWatch metrics are disabled locally and emitted as structured logs instead.

### Local verification

Open `http://localhost:3000`, create a local account, and add an item. It
should move from `PROCESSING` to `READY` after background removal and metadata
extraction.

## Useful Commands

Frontend:

```bash
cd frontend
npm test
npm run build
```

Backend and worker logs:

```bash
cd backend
docker compose logs -f image-worker
```

LocalStack inspection:

```bash
cd backend
docker compose exec localstack awslocal sqs list-queues
docker compose exec localstack awslocal dynamodb scan --table-name wardrobe-vision-metadata-cache
docker compose exec localstack awslocal s3 ls s3://closethop-images --recursive
```

Infrastructure validation:

```bash
cd infrastructure
npm test
npm run build
npm run synth
```

## Authentication Modes

The frontend supports local auth by default and Cognito in production.

For Cognito mode, copy the CDK stack outputs into `frontend/.env`, set
`VITE_AUTH_MODE=cognito`, and provide:

- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_DOMAIN`
- Cognito callback and logout URLs if they differ from the localhost defaults

The Cognito user pool must allow the `USER_AUTH` flow and email OTP. Google
sign-in also requires the client configuration and Cognito
`/oauth2/idpresponse` callback described in the production deployment section.

## Configuration Notes

- `frontend/.env.example` controls the API base URL and auth mode.
- `backend/.env.example` is used by the LocalStack and worker compose setup.
- The backend can also run against PostgreSQL and Cognito in production via the
  values documented in `backend/.env.example`.
- Production runs `app.handler` in Lambda. The Lambda worker reads the Gemini
  key from Secrets Manager, publishes CloudWatch custom metrics, and can reuse
  prior metadata for repeated image hashes.
