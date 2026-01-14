# Predeploy readiness (Docker + admin healthcheck)

## Цель

- Убрать блокеры перед прод деплоем.
- Сделать диагностику доступной из админского чата (без SSH доступа к серверу).

## Что сделано

- Docker:
  - В `apps/todo_bot/Dockerfile` и `apps/reminders_worker/Dockerfile` добавлена установка зависимостей `core` (npm ci в `/app/core`).
  - Добавлен `.dockerignore`, чтобы сборка не тащила `node_modules` и `data`.
  - В образ todo bot добавлено копирование `execution_history/`, чтобы admin команды `/history_*` работали в контейнере.

- Admin команды (Telegram):
  - `/healthcheck` (алиас `/hc`) - проверка Postgres + Notion прямо из чата.
  - `/healthcheck_json` - то же, но в JSON.
  - `/restart_polling` - перезапуск Telegram polling в текущем процессе.
  - `/restart_process confirm` - завершить процесс (нужен supervisor, например Docker restart policy).

- Рефакторинг:
  - Admin команды и часть диагностической логики вынесены из `core/dialogs/todo_bot.js` в `core/dialogs/todo_bot_admin.js`.

## Файлы (high signal)

- `apps/todo_bot/Dockerfile`
- `apps/reminders_worker/Dockerfile`
- `.dockerignore`
- `core/runtime/healthcheck_lib.js`
- `core/runtime/healthcheck.js`
- `core/dialogs/todo_bot_admin.js`
- `core/dialogs/todo_bot.js`
- `docs/current/commands.md`
- `docs/devops/index.md`

## Как проверить

### Docker (prod compose)

- Сборка:
  - `docker compose -f infra/docker-compose.prod.yml build`
- Запуск:
  - `docker compose -f infra/docker-compose.prod.yml up -d`

### Healthcheck (CLI)

- `node core/runtime/healthcheck.js --postgres --notion`

### Healthcheck (Telegram)

- В админском чате:
  - `/healthcheck`
  - `/healthcheck_json`

### Reboot (Telegram)

- В админском чате:
  - `/restart_polling`
  - `/restart_process confirm`

