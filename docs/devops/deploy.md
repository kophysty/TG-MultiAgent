# Деплой (prod runbook)

Цель - сделать деплой воспроизводимым, безопасным и одинаковым при запуске из разных интерфейсов (Cursor, Claude Code, обычный SSH).

## Пререквизиты

- На сервере установлены `docker` и `docker compose`.
- На сервере есть доступ к репозиторию и актуальная версия кода (git pull).
- В `.env` на сервере заданы:
  - `TELEGRAM_BOT_TOKEN_PROD` (или другой токен, который использует prod режим)
  - `TG_BOT_MODE=prod`
  - `NOTION_TOKEN`
  - `NOTION_TASKS_DB_ID`, `NOTION_IDEAS_DB_ID`, `NOTION_SOCIAL_DB_ID`, `NOTION_JOURNAL_DB_ID`
  - `NOTION_PREFERENCES_DB_ID`
  - Postgres переменные для prod compose (или дефолты): `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Notion базы расшарены интеграции, чей токен лежит в `NOTION_TOKEN`.

## Быстрый деплой одной командой

В корне репозитория на сервере:

- `bash infra/deploy/prod_deploy.sh`

Что делает скрипт:

- Поднимает `postgres`
- Ждет `healthy`
- Применяет миграции (`infra/db/migrate.sh`)
- Поднимает `todo_bot` и `reminders_worker`
- Запускает `healthcheck` внутри контейнера `todo_bot`

## Проверки после деплоя

- В админ чате:
  - `/healthcheck` - все секции должны быть ok, в Notion строках видны хвосты DB ID для быстрой сверки.
- Локально на сервере:
  - `docker compose -f infra/docker-compose.prod.yml ps`
  - `docker logs tg-multiagent-todo-bot --tail 200`
  - `docker logs tg-multiagent-reminders-worker --tail 200`

## Миграции отдельно (если нужно)

- Статус:
  - `bash infra/db/migrate.sh --status`
- Применить:
  - `bash infra/db/migrate.sh --apply`

## Типовые проблемы

### Healthcheck Notion fail, но бот "что-то делает"

Чаще всего причина - часть `NOTION_*_DB_ID` не задана в `.env`, и бот может работать на дефолтных ID из кода, а healthcheck проверяет только env.

Решение:

- Явно прописать все `NOTION_*_DB_ID` в `.env`
- Перезапустить контейнеры
- Перепроверить `/healthcheck`


