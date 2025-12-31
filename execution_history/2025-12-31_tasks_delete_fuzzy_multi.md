# Sprint: Tasks delete UX - fuzzy resolve RU-LAT and multi-delete queue

Date: 2025-12-31

## Goal

Сделать удаление задач через AI и voice предсказуемым:

- по запросу "удали" бот должен сразу вести к подтверждению действия, без повторного уточнения "что делать"
- поиск задачи должен находить латинские заголовки по русской транскрипции (voice)
- удаление нескольких задач из одного сообщения должно работать цепочкой подтверждений

## Scope

- In scope:
  - улучшение резолва задач по названию (RU voice - LAT title)
  - устранение "вторых веток" из-за некорректной очереди
  - multi-delete: очередь подтверждений по нескольким задачам
  - UX: в подтверждении всегда показывать название задачи
- Out of scope:
  - новые команды
  - изменение Notion схемы задач

## Key decisions

- Decision: Fallback на локальный fuzzy по последним задачам
  - Rationale:
    - Notion query `Name contains` не может матчить кириллицу на латиницу
    - voice часто дает неточные формулировки, поэтому нужен tolerant match
  - Alternatives considered:
    - только повторные попытки через Notion query variants
    - ручной выбор только по last shown list

- Decision: Multi-delete по очереди подтверждений
  - Rationale:
    - безопаснее, чем "удалить все сразу"
    - дает пользователю контроль на каждом шаге

## Changes implemented

- Summary:
  - Добавлен `findTasksFuzzyEnhanced`:
    - транслитерация RU -> LAT
    - нормализация и расширенные варианты query
    - fallback: локальный fuzzy score по последним задачам (limit 100)
  - Улучшен разбор multi-delete:
    - очередь формируется только если реально есть список
    - защита от ложных разбиений (например "найди и удали ...")
    - не ломаем время вида `4:46`
    - чистка мусорных префиксов voice ("привет", "найди", "удали", "task был")
  - UX:
    - если в исходном сообщении явно "удали" - сразу подтверждение Deprecated по найденной задаче
    - подтверждение для каждого шага показывает название задачи
    - очередь `_queueQueries` прокидывается между шагами до конца

## Files changed (high signal)

- `core/dialogs/todo_bot_helpers.js`
  - Добавлены `findTasksFuzzyEnhanced`, `buildMultiQueryCandidates`, `inferRequestedTaskActionFromText`
  - Исправлены Unicode pitfalls: избегаем ASCII-only `\\W` для русских текстов
- `core/dialogs/todo_bot_executor.js`
  - Автоматический переход к `move_to_deprecated` по "удали"
  - Поддержка multi-delete очереди и ее продолжения между шагами
  - Подтверждение `move_to_deprecated` всегда с названием задачи
- `core/dialogs/todo_bot_callbacks.js`
  - Продолжение цепочки удаления после подтверждения
- `apps/todo_bot/package.json`
  - Bump версии (чтобы `/start` показывал актуальную версию)

## Validation

- Steps:
  - Voice or text:
    - "Найди и удали в борде задачу автоматика 4 единицы"
    - "Удали из борды с задачами: Automatic 4 единицы, Focus Conf UI, потом Test Time Task 4:46 и Dev TikTok for Leo"
  - Подтверждать удаление по кнопке `Подтвердить`
- Expected result:
  - бот находит нужную задачу по RU voice и сразу предлагает Deprecated
  - нет "второй ветки" после удаления одиночной задачи
  - при списке задач бот продолжает цепочку до конца
  - в каждом подтверждении виден заголовок задачи

## Follow-ups

- Добавить в `docs/devops/pitfalls.md` заметку про `\\W` и Unicode (кириллица)
- Подумать над режимом "удалить все найденные" одним подтверждением (не по умолчанию)


