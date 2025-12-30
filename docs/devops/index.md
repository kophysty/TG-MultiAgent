# DevOps (runbook)

Этот раздел - практические заметки по запуску, обслуживанию и типовым техническим манипуляциям в проекте.

## Принципы

- Notion - первоисточник и витрина
- Postgres - операционное состояние (подписки, дедуп, очереди, память)
- Бот и воркеры - отдельные процессы (так проще управлять и перезапускать)

## Запуск локально (dev)

### Todo bot

- Команда:
  - `cd apps/todo_bot`
  - `TG_BOT_MODE=tests TG_DEBUG=1 npm start`

### Reminders worker

- Команда:
  - `cd apps/reminders_worker`
  - `TG_BOT_MODE=tests TG_DEBUG=1 node src/main.js`

Важно:

- Один Telegram бот не должен одновременно иметь активный webhook и polling consumer.

## Postgres

### Подключение

- В `.env` задаем `POSTGRES_URL`.

### Миграции

- Применяем SQL миграции из `infra/db/migrations/` внутри контейнера Postgres.

## Notion доступы

### Интеграция по `NOTION_TOKEN` (обычный Notion API)

- Все базы, с которыми работает код, должны быть расшарены интеграции, чей токен лежит в `NOTION_TOKEN`.
- В коде мы используем `database_id` (то, что обычно в URL Notion).

### Notion MCP: `data_source_id` vs `database_id`

Через MCP используются другие методы, и там важно различать идентификаторы:

- `database_id` - то, что в URL, и то что мы храним как `NOTION_*_DB_ID`
- `data_source_id` - то, что возвращает MCP `search` как `data_source.id` и что нужно для `retrieve/query data source`

Как работать:

- Сначала делаем `search` с фильтром `object=data_source`
- Берем `id` результата и используем его для `retrieve/query`
- Если у тебя есть только `database_id`, проверяй `parent.database_id` у найденного `data_source`, чтобы сопоставить

## Принятые решения (коротко)

- Notion CRUD для доменных баз (Tasks, Ideas, Social, Journal) делаем через repo слой в `core/connectors/notion`.
- Дедупликацию и расписания держим в Postgres и worker процессах.

## Подводные камни (негативный опыт)

- [Как не делать: pitfalls](./pitfalls.md)


