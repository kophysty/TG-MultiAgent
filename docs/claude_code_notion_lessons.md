# Claude Code + Notion API: Уроки и подводные камни

> Документ создан: 2026-01-12
> Контекст: интеграция Claude Code с Notion для работы с Tasks Base

## 1. MCP Notion Server — проблема с вложенными объектами

**Проблема:** MCP сервер `@notionhq/notion-mcp-server` некорректно сериализует вложенные объекты в параметрах. При вызове `API-post-page` параметр `parent` передаётся как строка вместо объекта.

**Ошибка:**
```
body failed validation: body.parent should be an object or `undefined`,
instead was `"{\"database_id\": \"...\"}"`
```

**Решение:** Использовать прямые curl запросы к Notion API вместо MCP инструментов для операций создания/обновления.

---

## 2. Windows + curl + UTF-8 кодировка

**Проблема:** При передаче русского текста напрямую в curl на Windows, кодировка ломается. Текст отображается как `��������`.

**Причина:** Windows cmd/PowerShell не корректно передают UTF-8 в аргументах командной строки.

**Решение:**
1. Записать JSON в файл (Write tool сохраняет в UTF-8)
2. Передать файл через `curl -d @filename.json`
3. Удалить временный файл после запроса

```bash
# Правильный способ:
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "Notion-Version: 2022-06-28" \
  -d @notion_task.json
```

---

## 3. Поиск vs Прямой доступ к базе данных

**Проблема:** `API-post-search` возвращает несколько баз с похожими именами. При этом ID, возвращаемый поиском, может быть ID linked database/view, а не оригинальной базы.

**Пример:**
- Поиск нашёл: `2d6535c9-00f0-812d-9823-000bff7cd7a4` — это view
- Реальная база: `2d6535c9-00f0-8191-a624-d325f66dbe7c` — это parent

**Решение:**
1. Проверить поле `parent` в результатах поиска
2. Если `parent.type === "database_id"`, использовать `parent.database_id` как реальный ID базы
3. Для проверки — запросить базу напрямую через `GET /databases/{id}`

---

## 4. Структура Tasks Base

**Database ID:** `2d6535c9-00f0-8191-a624-d325f66dbe7c`

**Свойства для создания задачи:**
```json
{
  "parent": {"database_id": "2d6535c9-00f0-8191-a624-d325f66dbe7c"},
  "properties": {
    "Name": {"title": [{"text": {"content": "Название задачи"}}]},
    "Tags": {"multi_select": [{"name": "Inbox"}]},
    "Status": {"status": {"name": "Idle"}},
    "Priority": {"select": {"name": "Med"}},
    "Due Date": {"date": {"start": "2026-01-15"}}
  }
}
```

**Доступные значения:**
- **Status:** Idle, In work, Done
- **Priority:** High, Med, Low
- **Tags:** Work, Home, Global, Everyday, Personal, Inbox, Deprecated

---

## 5. Удаление задачи

Для удаления используется PATCH с `in_trash: true`:

```bash
curl -s -X PATCH "https://api.notion.com/v1/pages/{page_id}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Notion-Version: 2022-06-28" \
  -d '{"in_trash": true}'
```

---

## Рекомендации для интеграции

1. **Для чтения** (поиск, список задач) — можно использовать MCP инструменты
2. **Для записи** (создание, обновление, удаление) — использовать curl с JSON файлами
3. **Всегда проверять** реальный ID базы данных через parent chain
4. **Кэшировать** ID базы данных после первого успешного запроса
