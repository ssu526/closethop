#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-/opt/closethop/repo/deploy/ec2}"
cron_file="/etc/cron.d/closethop-postgres-backup"

sudo tee "${cron_file}" >/dev/null <<EOF
15 7 * * * ec2-user cd ${app_dir} && /usr/bin/docker compose --env-file .env -f compose.prod.yml --profile backup run --rm backup >> /var/log/closethop-backup.log 2>&1
EOF

sudo chmod 0644 "${cron_file}"
echo "Installed nightly ClosetHop backup cron at ${cron_file}"
