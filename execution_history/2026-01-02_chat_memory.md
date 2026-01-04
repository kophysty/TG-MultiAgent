# Sprint: chat memory + chat summaries

Date: 2026-01-02

## Goal

Добавить устойчивую диалоговую память в Postgres (последние сообщения + summary), чтобы бот мог сохранять контекст переписки и лучше планировать действия после рестарта.

## Scope

- In scope:
  - Схема Postgres для `chat_messages` и `chat_summaries`
  - Запись user и assistant сообщений в БД
  - Инъекция chat memory (summary + last N) в planner контекст
  - Асинхронный summary tick в worker
  - TTL purge для `chat_messages`
- Out of scope:
  - Preference extractor и UX подсказки "сохранить предпочтение"
  - Work context cache (tasks/ideas/social)
  - Event log и trace_id

## Key decisions

- Decision: писать assistant сообщения через proxy вокруг `bot.sendMessage`
  - Rationale: исходящие сообщения формируются в разных местах (`todo_bot.js`, executor, callbacks, voice), и ручное протаскивание `sendAndStore()` было бы слишком инвазивным и легко ломается.
  - Alternatives considered: полный перевод всех `bot.sendMessage` на `sendAndStore()` и ручная дисциплина.

- Decision: отдельный sanitize для storage
  - Rationale: нельзя сохранять токены и ключи в `chat_messages` и будущих диагностических таблицах.

## Changes implemented

- Summary:
  - Добавлены таблицы `chat_messages` и `chat_summaries` (миграция 006).
  - Бот сохраняет входящие text сообщения пользователя и исходящие сообщения бота в Postgres (best-effort).
  - Planner получает chat summary и последние сообщения как дополнительный контекст.
  - Worker периодически пересчитывает `chat_summaries` через LLM и чистит `chat_messages` по TTL.

## Files changed (high signal)

- `infra/db/migrations/006_chat_memory.sql`
  - Postgres схема chat memory
- `core/connectors/postgres/chat_memory_repo.js`
  - Repo для append/list/summary/purge
- `core/runtime/log_sanitize.js`
  - Добавлен sanitize для storage (redact tokens/keys)
- `core/dialogs/todo_bot.js`
  - Proxy для `sendMessage` и инъекция chat memory в planner
  - Запись входящих user сообщений
- `core/dialogs/todo_bot_voice.js`
  - Сохранение voice transcript в chat memory (best-effort) и передача контекста в planner
- `core/ai/agent_planner.js`
  - Добавлены поля контекста: chat summary + recent messages + work context (пока work context не используется)
- `core/ai/chat_summarizer.js`
  - LLM summarizer для сводки чата
- `apps/reminders_worker/src/main.js`
  - `chatSummaryTick` (batch + TTL purge)
- `apps/todo_bot/package.json`
  - bump version
- `apps/reminders_worker/package.json`
  - bump version
- `docs/current/memory.md`
  - Документация по chat memory и env переменным

## Validation

- Steps:
  - Применить миграцию `006_chat_memory.sql` к Postgres.
  - Запустить `apps/todo_bot` с `POSTGRES_URL`, `TG_AI=1`, `OPENAI_API_KEY`.
  - Написать боту несколько сообщений в чат (chatId например 104999109).
  - Проверить в БД:
    - `SELECT role, left(text, 120), created_at FROM chat_messages WHERE chat_id = 104999109 ORDER BY created_at DESC LIMIT 10;`
  - Запустить `apps/reminders_worker` с `POSTGRES_URL` и `OPENAI_API_KEY`.
  - Дождаться summary tick и проверить:
    - `SELECT summary, updated_at, last_message_id FROM chat_summaries WHERE chat_id = 104999109;`
- Expected result:
  - В `chat_messages` появляются user и assistant сообщения.
  - В `chat_summaries` появляется непустая сводка.

## Follow-ups

- Preference extractor + memory_suggestions UX.
- Work context cache и auto injection policy.
- Observability: event_log + trace_id + diag bundle.



