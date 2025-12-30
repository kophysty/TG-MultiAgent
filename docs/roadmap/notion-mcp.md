# MCP для Notion (официальное)

С MCP идея хорошая: Notion становится "набором инструментов", которые агент дергает стандартно.

Лучший вариант сейчас - официальный Notion MCP:

- есть официальный репозиторий: `makenotion/notion-mcp-server` ([GitHub](https://github.com/makenotion/notion-mcp-server))
- есть официальный hosted endpoint: `https://mcp.notion.com` с OAuth (без плясок с токенами)

Практика подключения:

- сначала пробуем hosted MCP `mcp.notion.com` (если подходит по стеку и доступу)
- иначе self-host: `makenotion/notion-mcp-server`

## Важно: database_id и data_source_id

В Notion есть два разных идентификатора, и из-за этого легко "упереться" в object_not_found.

- `database_id`: то, что обычно видно в URL Notion и что мы храним в `.env` как `NOTION_*_DB_ID`.
- `data_source_id`: то, с чем работает Notion MCP для операций `retrieve/query data source`.

Правило:

- Через MCP сначала делаем `search` с фильтром `object=data_source` и берем `id` найденного объекта. Это и есть `data_source_id`.
- Если у тебя есть только `database_id`, найди data source через `search` и проверь `parent.database_id` в результате, чтобы убедиться что это та же база.

Мини-процедура проверки доступа:

- В Notion у базы должен быть доступ для интеграции, под которой работает MCP (например `TG-MultiAgent`).
- После этого `search` должен возвращать `data_source` для этой базы.


