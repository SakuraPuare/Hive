#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/seed-local-demo.sql"

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-hive}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-hive}"
MYSQL_DB="${MYSQL_DB:-hive_registry}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-hive-mysql}"

run_with_mysql_cli() {
  MYSQL_PWD="${MYSQL_PASSWORD}" mysql \
    -h "${MYSQL_HOST}" \
    -P "${MYSQL_PORT}" \
    -u "${MYSQL_USER}" \
    "${MYSQL_DB}" < "${SQL_FILE}"
}

run_with_docker_exec() {
  docker exec -i "${MYSQL_CONTAINER}" mysql \
    -u "${MYSQL_USER}" \
    "-p${MYSQL_PASSWORD}" \
    "${MYSQL_DB}" < "${SQL_FILE}"
}

if command -v mysql >/dev/null 2>&1; then
  run_with_mysql_cli
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -Fxq "${MYSQL_CONTAINER}"; then
  run_with_docker_exec
else
  echo "seed-local-demo: mysql CLI not found and docker container '${MYSQL_CONTAINER}' is not running" >&2
  echo "Set MYSQL_* env vars or start MySQL first." >&2
  exit 1
fi

echo "seed-local-demo: demo nodes and subscription groups inserted into ${MYSQL_DB}"
