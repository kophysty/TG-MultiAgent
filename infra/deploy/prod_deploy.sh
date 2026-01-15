#!/usr/bin/env bash
set -euo pipefail

export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="infra/docker-compose.prod.yml"
PG_CONTAINER="${POSTGRES_CONTAINER_NAME:-tg-multiagent-postgres}"

usage() {
  cat <<'EOF'
Usage:
  infra/deploy/prod_deploy.sh [--skip-build] [--skip-healthcheck] [--timeout-sec N]

What it does:
  - docker compose up postgres
  - wait for postgres health
  - apply migrations via infra/db/migrate.sh
  - docker compose up bot and worker (optionally build)
  - run in-container healthcheck (optional)
EOF
}

SKIP_BUILD="0"
SKIP_HEALTHCHECK="0"
TIMEOUT_SEC="120"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD="1"; shift ;;
    --skip-healthcheck) SKIP_HEALTHCHECK="1"; shift ;;
    --timeout-sec) TIMEOUT_SEC="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

echo "Deploy start (compose: $COMPOSE_FILE)"

echo "Step: start postgres"
docker compose -f "$COMPOSE_FILE" up -d postgres

echo "Step: wait postgres health (container: $PG_CONTAINER, timeout: ${TIMEOUT_SEC}s)"
start_ts="$(date +%s)"
while true; do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "Postgres is healthy"
    break
  fi
  now_ts="$(date +%s)"
  if [[ $((now_ts - start_ts)) -ge "$TIMEOUT_SEC" ]]; then
    echo "Timeout waiting for Postgres to become healthy. Current status: ${status:-unknown}" >&2
    docker ps --filter "name=$PG_CONTAINER" || true
    exit 1
  fi
  sleep 2
done

echo "Step: apply migrations"
bash infra/db/migrate.sh --apply --container-name "$PG_CONTAINER"

echo "Step: start app services"
if [[ "$SKIP_BUILD" == "1" ]]; then
  docker compose -f "$COMPOSE_FILE" up -d todo_bot reminders_worker
else
  docker compose -f "$COMPOSE_FILE" up -d --build todo_bot reminders_worker
fi

if [[ "$SKIP_HEALTHCHECK" == "1" ]]; then
  echo "Skip healthcheck"
else
  echo "Step: healthcheck (inside todo_bot container)"
  docker compose -f "$COMPOSE_FILE" exec -T todo_bot node /app/core/runtime/healthcheck.js --postgres --notion
fi

echo "Deploy done"


