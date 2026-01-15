# 2026-01-15 - Deploy runbook + миграции + healthcheck DB ID

## Goal

- Сделать деплой воспроизводимым одной командой.
- Снизить риск "забыли миграции" и поймали частично сломанное состояние.
- Упростить диагностику Notion конфигурации через короткие хвосты DB ID в healthcheck.

## Key decisions

- Миграции применяем идемпотентным скриптом `infra/db/migrate.sh`:
  - Скрипт трекает примененные файлы в таблице `schema_migrations` (создает ее при необходимости).
  - Повторный запуск безопасен.
- Prod deploy flow автоматизирован скриптом `infra/deploy/prod_deploy.sh`:
  - `postgres` -> ожидание `healthy` -> миграции -> `todo_bot` и `reminders_worker` -> healthcheck.
- Healthcheck Notion теперь показывает хвост DB ID `(...xxxxx)` в `info`, чтобы глазами сверять, что env указывает на правильную базу.

## Implementation summary

- Healthcheck:
  - Добавлен helper `tailId()` и вывод хвостов DB ID в `core/runtime/healthcheck_lib.js`.
  - Добавлена опциональная проверка `NOTION_TASKS_TEST_DB_ID` (если задана).
- Ops:
  - Добавлен `infra/db/migrate.sh` (status/apply, schema_migrations).
  - Добавлен `infra/deploy/prod_deploy.sh` (end-to-end flow).
- Docs:
  - Добавлен runbook `docs/devops/deploy.md`.
  - Обновлены ссылки и примеры в `docs/devops/index.md` и `README.md`.

## Files changed (high signal)

- `core/runtime/healthcheck_lib.js`
- `infra/db/migrate.sh`
- `infra/deploy/prod_deploy.sh`
- `docs/devops/deploy.md`
- `docs/devops/index.md`
- `README.md`

## How to validate

На сервере в корне репозитория:

- `bash infra/deploy/prod_deploy.sh`

Проверить:

- В админ чате `/healthcheck`:
  - Postgres ok
  - Notion ok
  - В Notion строках видны хвосты DB ID `(...dbe7c)` и их легко сверить с `.env`

## Follow-ups

- Можно добавить режим `--dry-run` в deploy скрипт (проверка env без запуска).
- Можно добавить healthcheck флаг `--telegram` в deploy сценарий по желанию.


