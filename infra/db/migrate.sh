#!/usr/bin/env bash
set -euo pipefail

export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

usage() {
  cat <<'EOF'
Usage:
  infra/db/migrate.sh [--prod] [--status] [--apply] [--container-name NAME] [--db DB] [--user USER]

Defaults:
  --apply (if neither --status nor --apply was provided)
  --container-name tg-multiagent-postgres
  --db  ${POSTGRES_DB:-tg_multiagent}
  --user ${POSTGRES_USER:-tg_multiagent}

Notes:
  - Uses docker exec into Postgres container by default
  - Safe to run multiple times (tracks applied filenames in schema_migrations)
EOF
}

MODE="apply"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-tg-multiagent-postgres}"
DB_NAME="${POSTGRES_DB:-tg_multiagent}"
DB_USER="${POSTGRES_USER:-tg_multiagent}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status) MODE="status"; shift ;;
    --apply) MODE="apply"; shift ;;
    --container-name) CONTAINER_NAME="$2"; shift 2 ;;
    --db) DB_NAME="$2"; shift 2 ;;
    --user) DB_USER="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

MIGR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/migrations"

if [[ ! -d "$MIGR_DIR" ]]; then
  echo "Migrations dir not found: $MIGR_DIR" >&2
  exit 1
fi

PSQL=(docker exec -i "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME")

ensure_table() {
  "${PSQL[@]}" -q -c "create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now());" >/dev/null
}

is_applied() {
  local f="$1"
  local out
  out="$("${PSQL[@]}" -qAt -c "select 1 from schema_migrations where filename = '$f' limit 1;" || true)"
  [[ "$out" == "1" ]]
}

list_files() {
  (cd "$MIGR_DIR" && ls -1 *.sql 2>/dev/null || true) | sort
}

status() {
  ensure_table
  local f
  local applied=0
  local pending=0
  echo "Migrations status:"
  for f in $(list_files); do
    if is_applied "$f"; then
      echo "- ok   $f"
      applied=$((applied+1))
    else
      echo "- todo $f"
      pending=$((pending+1))
    fi
  done
  echo ""
  echo "Totals: applied=$applied pending=$pending"
}

apply_all() {
  ensure_table
  local f
  local applied_now=0
  for f in $(list_files); do
    if is_applied "$f"; then
      continue
    fi
    echo "Apply: $f"
    "${PSQL[@]}" < "$MIGR_DIR/$f"
    "${PSQL[@]}" -q -c "insert into schema_migrations(filename) values ('$f') on conflict do nothing;" >/dev/null
    applied_now=$((applied_now+1))
  done
  echo ""
  echo "Applied now: $applied_now"
}

case "$MODE" in
  status) status ;;
  apply) apply_all ;;
  *) echo "Bad mode: $MODE" >&2; exit 2 ;;
esac

