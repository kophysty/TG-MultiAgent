# Tasks: summary после update и лимит title

## Цель

1) После обновления задачи показывать пользователю детальный summary, как после создания.

2) Не допускать слишком длинных заголовков задач. Если `title` длиннее 120 символов, использовать короткий title, а полный текст складывать в описание.

## Изменения

### Summary после update

- Добавлен форматтер `formatTaskUpdateSummary` в `core/dialogs/todo_bot_helpers.js`.
- В `core/dialogs/todo_bot_callbacks.js` обработчик `notion.update_task` теперь:
  - применяет patch через Notion
  - при наличии description (например, после разрезания длинного title) добавляет текст в описание задачи
  - отвечает summary: база, категория, срок, приоритет, статус, ссылка

### Лимит title 120 символов

- Добавлен helper `splitLongTaskTitleToDescription` в `core/dialogs/todo_bot_helpers.js`.
- Применено в `core/dialogs/todo_bot_executor.js`:
  - для `notion.create_task` (включая dedup confirm путь)
  - для `notion.update_task` (если модель передала title)
- Для планнера добавлено правило в `core/ai/agent_planner.js`:
  - `args.title` должен быть не длиннее 120 символов
  - детали и контекст должны быть в `args.description`

## Файлы изменены

- `core/dialogs/todo_bot_helpers.js`
- `core/dialogs/todo_bot_executor.js`
- `core/dialogs/todo_bot_callbacks.js`
- `core/ai/agent_planner.js`
- `apps/todo_bot/package.json`
- `CHANGELOG.md`
- `HISTORY.md`

## Как проверить

1) Обновить задачу (например, "перенеси задачу 3 в Inbox") и убедиться, что ответ содержит детальные поля.

2) Создать задачу с очень длинным текстом и убедиться, что:
   - title в Notion короткий
   - полный текст попадает в описание


