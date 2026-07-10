#!/bin/sh
set -eu

if [ -n "${PORT:-}" ] && [ -z "${SERVER_PORT:-}" ]; then
  export SERVER_PORT="${PORT}"
fi

if [ -z "${DATASOURCE_URL:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  export DATASOURCE_URL="${DATABASE_URL}"
fi

normalize_render_postgres_url() {
  raw_url="$1"
  scheme_and_rest="${raw_url#*://}"
  credentials="${scheme_and_rest%%@*}"
  host_and_path="${scheme_and_rest#*@}"
  username="${credentials%%:*}"
  password="${credentials#*:}"

  if [ -n "${username}" ] && [ "${username}" != "${credentials}" ] && [ -z "${DATASOURCE_USERNAME:-}" ]; then
    export DATASOURCE_USERNAME="${username}"
  fi

  if [ -n "${password}" ] && [ "${password}" != "${credentials}" ] && [ -z "${DATASOURCE_PASSWORD:-}" ]; then
    export DATASOURCE_PASSWORD="${password}"
  fi

  export DATASOURCE_URL="jdbc:postgresql://${host_and_path}"
}

case "${DATASOURCE_URL:-}" in
  postgres://*|postgresql://*)
    normalize_render_postgres_url "${DATASOURCE_URL}"
    ;;
esac

exec java -jar /app/app.jar
