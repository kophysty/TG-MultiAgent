# 2026-01-04 - Docker Compose для prod

## Цель

Собрать Docker Compose для продакшена, который поднимает Postgres, todo bot и reminders worker с restart policy, healthcheck и базовыми logging настройками.

## Что сделано

- Добавлен `infra/docker-compose.prod.yml`:
  - сервисы: `postgres`, `todo_bot`, `reminders_worker`
  - `restart: unless-stopped`
  - healthcheck:
    - Postgres через `pg_isready`
    - bot: `node core/runtime/healthcheck.js --postgres --notion` (без Telegram send)
    - worker: `node core/runtime/healthcheck.js --postgres`
  - logging driver `json-file` с ротацией
- Добавлены Dockerfile:
  - `apps/todo_bot/Dockerfile`
  - `apps/reminders_worker/Dockerfile`
- Документация:
  - `README.md`
  - `docs/current/commands.md`

## Как проверить

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```

## Примечания

- Внутри docker сети host Postgres это `postgres`, а не `localhost`, поэтому `POSTGRES_URL` в compose задан с host `postgres`.


