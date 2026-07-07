#!/bin/sh
set -eu

#Create S3 bucket if missing
awslocal s3api head-bucket --bucket closethop-images 2>/dev/null ||
  awslocal s3api create-bucket --bucket closethop-images

#Create dead-letter queue
DLQ_URL="$(awslocal sqs get-queue-url --queue-name closethop-image-processing-dlq \
  --query QueueUrl --output text 2>/dev/null ||
  awslocal sqs create-queue --queue-name closethop-image-processing-dlq \
    --query QueueUrl --output text)"

# Get DLQ ARN
DLQ_ARN="$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

# Create main processing queue
PROCESSING_URL="$(awslocal sqs get-queue-url --queue-name closethop-image-processing \
  --query QueueUrl --output text 2>/dev/null ||
  awslocal sqs create-queue --queue-name closethop-image-processing \
    --query QueueUrl --output text)"

# Get processing queue ARN
PROCESSING_ARN="$(awslocal sqs get-queue-attributes --queue-url "$PROCESSING_URL" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

# Set visibility timeout
awslocal sqs set-queue-attributes \
  --queue-url "$PROCESSING_URL" \
  --attributes VisibilityTimeout=60

# Attach DLQ policy
awslocal sqs set-queue-attributes \
  --queue-url "$PROCESSING_URL" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

# Allow S3 to send messages to SQS
awslocal sqs set-queue-attributes \
  --queue-url "$PROCESSING_URL" \
  --attributes "{\"Policy\":\"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":{\\\"Service\\\":\\\"s3.amazonaws.com\\\"},\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"$PROCESSING_ARN\\\"}]}\"}"

# Configure S3 bucket notification
awslocal s3api put-bucket-notification-configuration \
  --bucket closethop-images \
  --notification-configuration "{\"QueueConfigurations\":[{\"QueueArn\":\"$PROCESSING_ARN\",\"Events\":[\"s3:ObjectCreated:*\"],\"Filter\":{\"Key\":{\"FilterRules\":[{\"Name\":\"prefix\",\"Value\":\"staging/\"}]}}}]}"

# Create results queue
awslocal sqs get-queue-url --queue-name closethop-image-processing-results >/dev/null 2>&1 ||
  awslocal sqs create-queue \
    --queue-name closethop-image-processing-results \
    --attributes VisibilityTimeout=30 \
    >/dev/null
