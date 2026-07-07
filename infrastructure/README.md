# ClosetHop AWS infrastructure

This TypeScript CDK app defines the single `dev` AWS environment. It creates
Cognito, RDS PostgreSQL, private S3 with short-lived signed URLs, and an ECS Express Gateway
Service for the Spring Boot container.

## Prerequisites

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

## Validate

```bash
npm install
npm test
npm run build
npm run synth
```

Override configuration with CDK context:

```bash
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

Deployment is intentionally not automated by this foundation milestone.
