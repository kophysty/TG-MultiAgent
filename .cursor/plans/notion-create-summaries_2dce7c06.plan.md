---
name: notion-create-summaries
overview: После создания записи в Notion бот будет явно писать в какую базу и с какими ключевыми полями он добавил запись (и давать ссылку), чтобы можно было быстро проверить и найти запись.
todos:
  - id: add-summary-formatters
    content: Добавить функции форматирования summary для created сущностей (tasks, ideas, social, journal) в core/dialogs/todo_bot_helpers.js
    status: completed
  - id: wire-into-executor
    content: Заменить короткие сообщения после create в core/dialogs/todo_bot_executor.js на форматированный summary
    status: completed
    dependencies:
      - add-summary-formatters
  - id: wire-into-callbacks
    content: Заменить короткие сообщения после create (dedup confirm path) в core/dialogs/todo_bot_callbacks.js на форматированный summary
    status: completed
    dependencies:
      - add-summary-formatters
  - id: bump-and-changelog
    content: Bump версии apps/todo_bot/package.json и обновить CHANGELOG.md, HISTORY.md, execution_history writeup
    status: completed
    dependencies:
      - wire-into-executor
      - wire-into-callbacks
---

# Summary после create в Notion

## Цель

Сделать так, чтобы после **создания** записи в Notion (tasks + ideas + social + journal) бот писал:

- куда именно добавил (какая база)
- какие ключевые параметры выставил (категория, даты, статусы, теги и т.д.)
- ссылку на страницу в Notion

Без inline кнопок, только текстовый summary.

## Где менять

- Добавить форматтеры summary в [`core/dialogs/todo_bot_helpers.js`](core/dialogs/todo_bot_helpers.js).
- Применить их в местах, где сейчас отправляется короткое `"Готово. Добавил ..."`:
- [`core/dialogs/todo_bot_executor.js`](core/dialogs/todo_bot_executor.js) (обычные create пути)
- [`core/dialogs/todo_bot_callbacks.js`](core/dialogs/todo_bot_callbacks.js) (create после подтверждения, например при dedup)

## Формат сообщений (пример)

### Tasks

- Всегда показываем базу и категорию.

Пример:

- `Готово. Создал задачу: <title>`
- `База: Tasks (main|test)`
- `Категория: Today (Inbox)` (если реальный тег `Inbox`, иначе просто имя тега; если тега нет, пишем `не указана`)
- `Срок: <dueDate>` (если есть)
- `Приоритет: <priority>` (если есть)
- `Статус: <status>` (если есть)
- `Ссылка: <created.url>` (если есть)

### Ideas

- `Готово. Добавил идею: <title>`
- `База: Ideas`
- `Категория: <categories>` (если нет - `не указана`)
- `Теги: <tags>` (если есть)
- `Area: <area>` (если есть)
- `Project: <project>` (если есть)
- `Статус: <status>` (если есть)
- `Приоритет: <priority>` (если есть)
- `Ссылка: <created.url>`

### Social posts

- `Готово. Добавил пост: <title>`
- `База: Social`
- `Платформа: <platform>` (если нет - `не указана`)
- `Статус: <status>` (если есть)
- `Дата поста: <postDate>` (если есть)
- `Тип: <contentType>` (если есть)
- `Post URL: <postUrl>` (если есть)
- `Ссылка: <created.url>`

### Journal

- `Готово. Добавил запись в дневник: <title>`
- `База: Journal`
- `Дата: <date>` (если нет - `не указана`)
- `Тип: <type>` (если есть)
- `Topics: <topics>` (если есть)
- `Context: <context>` (если есть)
- `Mood: <mood>` и `Energy: <energy>` (если есть)
- `Ссылка: <created.url>`

## Версии и логи изменений

- Bump версии `apps/todo_bot/package.json`.
- Обновить `CHANGELOG.md` и `HISTORY.md`.
- Добавить короткий writeup в `execution_history/` и обновить `execution_history/index.md`.

## Проверка

- Unit tests: `npm test --prefix core`.
- Точечный e2e прогон на create кейсы (например через `apps/evals/src/e2e_runner.js` с небольшим датасетом), чтобы убедиться что summary появляется и поля выглядят ожидаемо.