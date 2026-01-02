# 2026-01-02 - Work context cache: Notion -> Postgres cache + bot injection

## Цель

Добавить "work context" для planner: актуальные задачи, идеи и посты из Notion, доступные боту как компактный контекст при запросах типа "что делать дальше" и "составь план".

## Scope

- In scope:
  - Таблица Postgres `work_context_cache` (строго per `chat_id`)
  - Worker tick: сбор контекста из Notion (Tasks 15d, Ideas recent, Social window -10..+10)
  - Bot injection: `TG_WORK_CONTEXT_MODE=auto|always` + ограничение по возрасту кэша
- Out of scope:
  - Персонализация work context (пока один payload копируется per chat_id, но изоляция ключом сохранена)

## Что сделано

### 1) Postgres

- Добавлена миграция `infra/db/migrations/008_work_context_cache.sql`
- Добавлен repo `core/connectors/postgres/work_context_repo.js`

### 2) Reminders worker

- Добавлен `workContextTick()`:
  - Tasks: date-range до 15 дней вперед плюс overdue и Inbox
  - Ideas: последние N
  - Social: окно -10..+10 дней
- Сохраняет компактный `payload.text` в `work_context_cache` с ключом `work_ctx`
- Пишет отдельно для каждого `chat_id` (изоляция per chat_id)

### 3) Todo bot

- Добавлен режим `TG_WORK_CONTEXT_MODE`:
  - `auto` (default) - инжект только для сообщений "обсуждение/планирование" по эвристике
  - `always` - всегда
  - `off` - никогда
- Добавлен `TG_WORK_CONTEXT_MAX_AGE_MIN` (default 720) - защита от использования устаревшего кэша
- Work context передается в planner как отдельный блок `Work context: ...`

## Как проверить

1) Применить миграцию:

```bash
docker exec -i tg-multiagent-postgres psql -U tg_multiagent -d tg_multiagent < infra/db/migrations/008_work_context_cache.sql
```

2) Запустить worker с переменными:

- `POSTGRES_URL`
- `NOTION_TOKEN`
- `NOTION_TASKS_DB_ID`
- `NOTION_IDEAS_DB_ID`
- `NOTION_SOCIAL_DB_ID`

3) Дождаться tick (или перезапустить worker) и проверить:

```bash
docker exec -i tg-multiagent-postgres psql -U tg_multiagent -d tg_multiagent -c "select chat_id, key, updated_at, left(payload->>'text', 120) as preview from work_context_cache order by updated_at desc limit 5;"
```

4) В боте написать что-то типа:

- "составь план на неделю"
- "на что фокусироваться дальше"

Ожидаемое:

- planner получает блок `Work context` и использует его при выборе инструментов и формулировке ответа.

## Follow-ups

- Сделать payload меньше и стабильнее (строгие лимиты строк и приоритеты).
- Добавить отдельные ключи `work_ctx_tasks|work_ctx_ideas|work_ctx_social` при необходимости.
- Добавить диагностику (healthcheck) на наличие `work_context_cache` и свежесть кэша.


