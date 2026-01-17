#!/bin/bash
# Скрипт для сбора логов с продакшн сервера
# Использование: ./scripts/fetch_logs.sh [--hours N] [--chat-id ID]
#
# Зависимости: ssh, sshpass (опционально для автоматического ввода пароля)
# На Windows: запускать через Git Bash или WSL

set -e

# Конфигурация сервера (из .env)
SERVER_HOST="${VPS_HOST:-45.80.70.145}"
SERVER_USER="${VPS_USER:-root}"
SERVER_PASS="${VPS_PASS:-}"  # Лучше использовать SSH ключи

# Параметры
HOURS=${HOURS:-24}
CHAT_ID=${CHAT_ID:-}
LINES=${LINES:-500}
OUTPUT_DIR="$(dirname "$0")/../server.logs"

# Парсинг аргументов
while [[ $# -gt 0 ]]; do
  case $1 in
    --hours)
      HOURS="$2"
      shift 2
      ;;
    --chat-id)
      CHAT_ID="$2"
      shift 2
      ;;
    --lines)
      LINES="$2"
      shift 2
      ;;
    --help)
      echo "Использование: $0 [--hours N] [--chat-id ID] [--lines N]"
      echo ""
      echo "Опции:"
      echo "  --hours N     Логи за последние N часов (по умолчанию: 24)"
      echo "  --chat-id ID  Фильтр по chat_id для event_log"
      echo "  --lines N     Количество строк Docker logs (по умолчанию: 500)"
      exit 0
      ;;
    *)
      echo "Неизвестный параметр: $1"
      exit 1
      ;;
  esac
done

# Создать директорию для логов
mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
echo "=== Сбор логов: $TIMESTAMP ==="
echo "Сервер: $SERVER_USER@$SERVER_HOST"
echo "Период: последние $HOURS часов"
echo "Выходная директория: $OUTPUT_DIR"
echo ""

# Функция для SSH команд
ssh_cmd() {
  if [ -n "$SERVER_PASS" ] && command -v sshpass &> /dev/null; then
    sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_HOST" "$@"
  else
    ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_HOST" "$@"
  fi
}

# 1. Docker logs - todo_bot
echo "[1/4] Собираю Docker logs: todo_bot..."
DOCKER_LOG_FILE="$OUTPUT_DIR/${TIMESTAMP}_docker_todo_bot.log"
ssh_cmd "docker logs tg-multiagent-todo-bot --tail $LINES --since ${HOURS}h 2>&1" > "$DOCKER_LOG_FILE" 2>&1 || echo "Ошибка при сборе todo_bot logs"
echo "  -> $DOCKER_LOG_FILE ($(wc -l < "$DOCKER_LOG_FILE") строк)"

# 2. Docker logs - reminders_worker
echo "[2/4] Собираю Docker logs: reminders_worker..."
REMINDERS_LOG_FILE="$OUTPUT_DIR/${TIMESTAMP}_docker_reminders_worker.log"
ssh_cmd "docker logs tg-multiagent-reminders-worker --tail $LINES --since ${HOURS}h 2>&1" > "$REMINDERS_LOG_FILE" 2>&1 || echo "Ошибка при сборе reminders_worker logs"
echo "  -> $REMINDERS_LOG_FILE ($(wc -l < "$REMINDERS_LOG_FILE") строк)"

# 3. Event log из Postgres
echo "[3/4] Собираю event_log из Postgres..."
EVENT_LOG_FILE="$OUTPUT_DIR/${TIMESTAMP}_event_log.json"

# SQL запрос с фильтром по времени и опционально по chat_id
if [ -n "$CHAT_ID" ]; then
  SQL_QUERY="SELECT json_agg(row_to_json(t)) FROM (
    SELECT id, ts, trace_id, chat_id, tg_update_id, tg_message_id, component, event, level, duration_ms, payload
    FROM event_log
    WHERE ts >= NOW() - INTERVAL '${HOURS} hours'
      AND chat_id = ${CHAT_ID}
    ORDER BY ts DESC
    LIMIT 1000
  ) t;"
else
  SQL_QUERY="SELECT json_agg(row_to_json(t)) FROM (
    SELECT id, ts, trace_id, chat_id, tg_update_id, tg_message_id, component, event, level, duration_ms, payload
    FROM event_log
    WHERE ts >= NOW() - INTERVAL '${HOURS} hours'
    ORDER BY ts DESC
    LIMIT 1000
  ) t;"
fi

ssh_cmd "docker exec tg-multiagent-postgres psql -U tg_multiagent -d tg_multiagent -t -A -c \"$SQL_QUERY\"" > "$EVENT_LOG_FILE" 2>&1 || echo "Ошибка при экспорте event_log"

# Проверить и форматировать JSON
if [ -s "$EVENT_LOG_FILE" ]; then
  # Попробовать форматировать JSON если установлен jq
  if command -v jq &> /dev/null; then
    jq '.' "$EVENT_LOG_FILE" > "${EVENT_LOG_FILE}.tmp" 2>/dev/null && mv "${EVENT_LOG_FILE}.tmp" "$EVENT_LOG_FILE" || true
  fi
  RECORDS=$(grep -c '"id"' "$EVENT_LOG_FILE" 2>/dev/null || echo "0")
  echo "  -> $EVENT_LOG_FILE (~$RECORDS записей)"
else
  echo "  -> Нет записей за указанный период"
fi

# 4. Статус контейнеров
echo "[4/4] Собираю статус контейнеров..."
STATUS_FILE="$OUTPUT_DIR/${TIMESTAMP}_container_status.txt"
ssh_cmd "docker compose -f /root/TG-MultiAgent/infra/docker-compose.prod.yml ps -a" > "$STATUS_FILE" 2>&1 || echo "Ошибка при получении статуса"
echo "  -> $STATUS_FILE"

echo ""
echo "=== Сбор завершён ==="
echo "Файлы в: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/${TIMESTAMP}_* 2>/dev/null || true
