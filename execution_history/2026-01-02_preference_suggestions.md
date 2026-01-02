# Sprint: preference suggestions

Date: 2026-01-02

## Goal

Добавить UX "предложить сохранить preference" и базовый LLM preference extractor, чтобы бот мог на лету предлагать закрепить устойчивые настройки пользователя.

## Scope

- In scope:
  - Postgres таблица `memory_suggestions`
  - LLM extractor (JSON candidates)
  - Inline кнопки `Сохранить` / `Не сохранять`
  - Accept: upsert в `preferences` + enqueue `pref_page_upsert` в `notion_sync_queue`
- Out of scope:
  - Work context cache (tasks/ideas/social)
  - Observability (event_log, trace_id)

## Key decisions

- Decision: запускать extractor best-effort в фоне и не блокировать основной ответ бота
  - Rationale: минимизируем latency на основные команды и tool вызовы.

## Changes implemented

- Summary:
  - Добавлена миграция `007_memory_suggestions.sql` и repo для работы с suggestions.
  - Добавлен `core/ai/preference_extractor.js` (LLM JSON).
  - Бот создает suggestion и показывает кнопки.
  - Callback handler сохраняет preference в Postgres и ставит задачу на синк в Notion.

## Files changed (high signal)

- `infra/db/migrations/007_memory_suggestions.sql`
- `core/connectors/postgres/memory_suggestions_repo.js`
- `core/ai/preference_extractor.js`
- `core/dialogs/todo_bot.js`
- `core/dialogs/todo_bot_callbacks.js`
- `apps/todo_bot/package.json`
- `docs/current/memory.md`

## Validation

- Steps:
  - Применить миграцию `007_memory_suggestions.sql`.
  - Запустить bot с `POSTGRES_URL`, `TG_AI=1`, `OPENAI_API_KEY`.
  - Написать сообщение с предпочтением, например: "запомни: отвечай коротко без эмодзи".
  - Проверить:
    - появится сообщение с кнопками `Сохранить` / `Не сохранять`
    - в Postgres появится строка в `memory_suggestions`
  - Нажать `Сохранить`:
    - `preferences` обновится
    - `notion_sync_queue` получит `pref_page_upsert`
- Expected result:
  - Preference сохраняется и синкится в Notion воркером.

## Follow-ups

- Снизить вероятность ложных срабатываний (тонкая эвристика + кулдаун).
- Добавить поддержку нескольких candidates и более точный маппинг категорий.


