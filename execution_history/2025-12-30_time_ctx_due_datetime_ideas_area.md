# Sprint: Time context, due datetime and Ideas Area

Date: 2025-12-30

## Goal

Стабилизировать работу с датами и временем (особенно "сегодня в 15:00") и довести Ideas DB до состояния, где `Area` заполняется автоматически и может расширяться без дублей.

## Scope

- In scope:
  - Передача планеру текущего времени и часового пояса (`TG_TZ`).
  - Детерминированный парсинг due date и due time из текста пользователя.
  - Ideas DB: заполнение `Area` по контексту и создание новых options для `Area` без дублей.
  - Reply keyboard: замена кнопки `/struct` на `Start` (работает как `/start`).
- Out of scope:
  - Универсальный парсинг любых форматов дат и времени.
  - Автозаполнение времени при обновлении задач (update) во всех сценариях.

## Key decisions

- Decision: планер всегда получает "сейчас" и `TG_TZ`
  - Rationale: без этого модель может выдумывать абсолютные даты (например 2024 год) и ошибаться в интерпретации "сегодня".
  - Alternatives considered: полностью доверять модели для due date.

- Decision: due datetime парсится детерминированно из `userText`
  - Rationale: защищает от сдвигов UTC против локального времени и от неверных абсолютных дат.
  - Alternatives considered: принимать due datetime только из `args.dueDate`.

- Decision: `Ideas.Area` может создавать новые options
  - Rationale: `Area` более гибкое поле, опции могут меняться часто, код не должен требовать ручных правок при добавлении новых опций в Notion.
  - Alternatives considered: всегда оставлять `Area` пустым при несовпадении.

## Changes implemented

- Summary:
  - Планер получает контекст времени (UTC и в TZ), а исполнитель парсит "сегодня/завтра/послезавтра + время" в ISO datetime с оффсетом.
  - Ideas DB: `Area` теперь не только маппится на существующие options, но и может создавать новые options без дублей.
  - Reply keyboard: `Start` вместо `/struct`.

## Files changed (high signal)

- `core/ai/agent_planner.js`
  - Передача контекста "Now" и `TG_TZ` в prompt.
- `core/dialogs/todo_bot.js`
  - Передача `tz` и `nowIso` в `planAgentAction`.
  - Reply keyboard: `Start` вместо `/struct` и обработчик `Start` как `/start`.
- `core/dialogs/todo_bot_voice.js`
  - Передача `tz` и `nowIso` в `planAgentAction` для voice.
- `core/dialogs/todo_bot_helpers.js`
  - Парсер due datetime из текста пользователя и сборка ISO с оффсетом.
- `core/dialogs/todo_bot_executor.js`
  - `notion.create_task`: dueDate сначала пытается извлекаться из `userText`.
- `core/connectors/notion/ideas_repo.js`
  - Добавлено создание options для `Area` без дублей (select и multi_select).
- `docs/current/ai.md`
  - Документация по времени, due datetime и `Ideas.Area`.
- `docs/current/bot-ui.md`
  - Документация по кнопке `Start` и скрытой команде `/struct`.
- `docs/current/index.md`
  - Обновлена текущая версия.

## Validation

- Steps:
  - В Telegram: "Поставь сегодня на 15:00 задачу X"
  - В Telegram: voice с фразой "сегодня в 15:00"
  - В Notion: проверить, что due date ровно сегодня 15:00 без сдвига по времени.
  - В Telegram: создать идею с контекстом "стартап, ремонт телефонов" и убедиться, что `Area` заполнена.
- Expected result:
  - Due date выставляется корректно по `TG_TZ`, время не сдвигается.
  - `Ideas.Area` заполнена, при отсутствии опции добавляется новая без дублей.

## Follow-ups

- Добавить аналогичный парсинг "сегодня в 15:00" для `update_task`.







