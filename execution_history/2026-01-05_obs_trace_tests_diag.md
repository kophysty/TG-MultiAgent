# 2026-01-05 - Observability: trace_id, event_log trail, tests, diag bundle

## Цель

- Усилить наблюдаемость: `trace_id` и полезный decision trail в Postgres `event_log`.
- Добавить базовый тест раннер и первые unit tests для helpers.
- Добавить CLI для диагностического bundle, чтобы быстро собирать контекст инцидента.

## Что сделано

### 1) Trace id и event_log (MVP -> ближе к полноценному)

- Добавлен `core/runtime/trace_context.js` на базе `AsyncLocalStorage`.
- `trace_id` выставляется для:
  - входящих сообщений (`todo_bot`)
  - callback query (`todo_bot`)
  - worker loop тиков (`reminders_worker`)
- В `event_log` пишем безопасные (sanitized) события:
  - `incoming_message`
  - `planner_plan`
  - `tool_call` (executor)
  - `notion_request`, `notion_response`, `notion_error`
  - `tg_send` (outbound)

### 2) Notion и Telegram event logging

- Notion HTTP client (`core/connectors/notion/client.js`) получил best-effort interceptors для event_log.
- Telegram outbound логируется:
  - через proxy wrapper в `todo_bot`
  - через обертку `sendMessage` в `reminders_worker`

### 3) Tests (node:test)

- В `core/package.json` добавлены scripts:
  - `npm test`
  - `npm run test:watch`
- Добавлены unit tests в `core/tests` для самых частых эвристик и нормализаций.

### 4) Diag bundle CLI

- Добавлен `apps/diag/src/main.js`:
  - собирает версии, безопасный env snapshot, и PG срез (event_log, chat memory при `--chat-id`, sent_reminders, notion_sync_queue)
  - пишет в `data/diag/` (папка в `.gitignore`)

### 5) Healthcheck JSON

- `core/runtime/healthcheck.js` поддерживает `--json` и возвращает JSON отчет + корректный exit code.

## Как проверить

Тесты:

```bash
cd core
npm test
```

Healthcheck JSON:

```bash
node core/runtime/healthcheck.js --json --postgres
```

Diag bundle:

```bash
node apps/diag/src/main.js --chat-id 104999109 --since-hours 24
```



