#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=closethop}"
: "${POSTGRES_USER:=closethop}"
: "${BACKUP_PREFIX:=postgres}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="/backups/${POSTGRES_DB}-${timestamp}.dump"
s3_uri="s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${POSTGRES_DB}-${timestamp}.dump"

export PGPASSWORD="${POSTGRES_PASSWORD}"

pg_dump \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --format custom \
  --no-owner \
  --file "${backup_file}"

aws s3 cp "${backup_file}" "${s3_uri}" --region "${AWS_REGION}" --only-show-errors

find /backups -type f -name "${POSTGRES_DB}-*.dump" -mtime +7 -delete

echo "Uploaded ${s3_uri}"
