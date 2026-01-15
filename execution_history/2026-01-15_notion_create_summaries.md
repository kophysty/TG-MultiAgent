# Summary после create в Notion

## Цель

Сделать так, чтобы после **создания** записи в Notion (tasks + ideas + social + journal) бот писал детальную информацию:
- куда именно добавил (какая база)
- какие ключевые параметры выставил (категория, даты, статусы, теги и т.д.)
- ссылку на страницу в Notion

Без inline кнопок, только текстовый summary.

## Реализация

### Добавлены форматтеры в `core/dialogs/todo_bot_helpers.js`

- `formatTaskCreateSummary({ created, board })` - для задач
- `formatIdeaCreateSummary({ created })` - для идей
- `formatSocialPostCreateSummary({ created })` - для постов
- `formatJournalEntryCreateSummary({ created })` - для записей дневника

Каждый форматтер формирует многострочное сообщение с:
- Заголовком "Готово. Создал/Добавил ..."
- Базой данных
- Категорией/тегами (или "не указана")
- Дополнительными полями (статус, приоритет, даты, ссылка и т.д.)

### Применено в местах создания

**`core/dialogs/todo_bot_executor.js`:**
- `notion.create_task` - заменено короткое сообщение на `formatTaskCreateSummary`
- `notion.create_idea` - заменено на `formatIdeaCreateSummary`
- `notion.create_social_post` - заменено на `formatSocialPostCreateSummary`
- `notion.create_journal_entry` - заменено на `formatJournalEntryCreateSummary`

**`core/dialogs/todo_bot_callbacks.js`:**
- Те же 4 пути после подтверждения dedup (когда пользователь подтверждает создание дубля)

## Формат сообщений

### Tasks
```
Готово. Создал задачу: <title>
База: Tasks (main|test)
Категория: <tags> (или "не указана")
Срок: <dueDate> (если есть)
Приоритет: <priority> (если есть)
Статус: <status> (если есть)
Ссылка: <url> (если есть)
```

### Ideas
```
Готово. Добавил идею: <title>
База: Ideas
Категория: <categories> (или "не указана")
Теги: <tags> (если есть)
Area: <area> (если есть)
Project: <project> (если есть)
Статус: <status> (если есть)
Приоритет: <priority> (если есть)
Ссылка: <url>
```

### Social posts
```
Готово. Добавил пост: <title>
База: Social
Платформа: <platform> (или "не указана")
Статус: <status> (если есть)
Дата поста: <postDate> (если есть)
Тип: <contentType> (если есть)
Post URL: <postUrl> (если есть)
Ссылка: <url>
```

### Journal
```
Готово. Добавил запись в дневник: <title>
База: Journal
Дата: <date> (или "не указана")
Тип: <type> (если есть)
Topics: <topics> (если есть)
Context: <context> (если есть)
Mood: <mood> (если есть)
Energy: <energy> (если есть)
Ссылка: <url>
```

## Файлы изменены

- `core/dialogs/todo_bot_helpers.js` - добавлены 4 форматтера summary
- `core/dialogs/todo_bot_executor.js` - применены форматтеры в 4 местах создания
- `core/dialogs/todo_bot_callbacks.js` - применены форматтеры в 4 местах после подтверждения dedup
- `apps/todo_bot/package.json` - версия 0.2.11 → 0.2.12
- `CHANGELOG.md` - добавлена запись для 0.2.12
- `HISTORY.md` - добавлена запись для 2026-01-15

## Проверка

- Unit tests: `npm test --prefix core` - все зеленые
- Рекомендуется точечный e2e прогон на create кейсы через `apps/evals/src/e2e_runner.js` с небольшим датасетом, чтобы убедиться что summary появляется и поля выглядят ожидаемо.

