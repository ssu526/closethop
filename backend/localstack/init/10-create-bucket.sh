#!/bin/sh
set -eu

# Create S3 bucket and processing queue if missing.
awslocal s3api head-bucket --bucket closethop-images 2>/dev/null ||
  awslocal s3api create-bucket --bucket closethop-images
awslocal sqs get-queue-url --queue-name closethop-image-processing >/dev/null 2>&1 ||
  awslocal sqs create-queue --queue-name closethop-image-processing >/dev/null

QUEUE_URL="$(awslocal sqs get-queue-url \
  --queue-name closethop-image-processing \
  --query 'QueueUrl' \
  --output text)"
QUEUE_ARN="$(awslocal sqs get-queue-attributes \
  --queue-url "${QUEUE_URL}" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)"

awslocal s3api put-bucket-cors \
  --bucket closethop-images \
  --cors-configuration '{"CORSRules":[{"AllowedMethods":["GET","HEAD","PUT"],"AllowedOrigins":["http://localhost:3000","http://localhost:5173"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":300}]}'
awslocal s3api put-bucket-notification-configuration \
  --bucket closethop-images \
  --notification-configuration "{\"QueueConfigurations\":[{\"QueueArn\":\"${QUEUE_ARN}\",\"Events\":[\"s3:ObjectCreated:*\"],\"Filter\":{\"Key\":{\"FilterRules\":[{\"Name\":\"prefix\",\"Value\":\"users/\"}]}}}]}"
