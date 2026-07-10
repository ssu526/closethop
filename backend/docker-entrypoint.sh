#!/bin/sh
set -eu

if [ -n "${PORT:-}" ] && [ -z "${SERVER_PORT:-}" ]; then
  export SERVER_PORT="${PORT}"
fi

if [ -z "${DATASOURCE_URL:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  export DATASOURCE_URL="${DATABASE_URL}"
fi

case "${DATASOURCE_URL:-}" in
  postgres://*|postgresql://*)
    export DATASOURCE_URL="jdbc:${DATASOURCE_URL}"
    ;;
esac

exec java -jar /app/app.jar
