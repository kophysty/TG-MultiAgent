# Claude Code — Project Memory

## Правила проекта

> Источник: `.cursor/rules/base-agent-rules.mdc`

1. **Никогда не сохранять файлы в корне проекта** — использовать подходящие поддиректории
2. **Никогда не делать rollback/revert/reset** без явного согласования с пользователем
3. **В чате говорим на русском**
4. **Документация на русском**
5. **Bump version** при функциональных изменениях (`apps/todo_bot/package.json`)
6. **Notion MCP** — использовать `data_source_id`, не `database_id` из URL
7. **Планы в `.cursor/plans/`** — с порядковым номером и датой в имени
8. **Имена файлов** — без заглавных букв, следовать стилю папки

---

## Notion Integration

### Tasks Base (рабочая)
- **Database ID:** `2d6535c9-00f0-8191-a624-d325f66dbe7c`
- **API Token:** переменная окружения или из `~/.claude/mcp.json`

### Создание задачи — шаблон
```bash
# Записать JSON в файл (для UTF-8 кодировки на Windows)
# Затем: curl -d @file.json

{
  "parent": {"database_id": "2d6535c9-00f0-8191-a624-d325f66dbe7c"},
  "properties": {
    "Name": {"title": [{"text": {"content": "Название"}}]},
    "Tags": {"multi_select": [{"name": "Inbox"}]},
    "Status": {"status": {"name": "Idle"}}
  }
}
```

### Значения полей
- **Status:** Idle → In work → Done
- **Priority:** High, Med, Low
- **Tags:** Work, Home, Global, Everyday, Personal, Inbox, Deprecated

---

## Важные файлы

### Правила и архитектура
| Файл | Описание |
|------|----------|
| `.cursor/rules/base-agent-rules.mdc` | Базовые правила для агентов |
| `docs/devops/pitfalls.md` | Антипаттерны и как их избежать |
| `docs/roadmap/agent-loop.md` | Архитектура Agent Loop |
| `docs/roadmap/repo-structure.md` | Структура репозитория |
| `docs/roadmap/responsibilities.md` | Разделение обязанностей |
| `docs/roadmap/tool-registry.md` | Tool Registry правила |

### Текущая реализация
| Файл | Описание |
|------|----------|
| `docs/current/index.md` | Общая документация, версия бота |
| `docs/current/memory.md` | Архитектура памяти (Postgres + Notion) |
| `docs/current/voice.md` | Voice pipeline |
| `docs/current/commands.md` | Команды бота |

### Коннекторы
| Путь | Описание |
|------|----------|
| `core/connectors/postgres/` | Репозитории для Postgres |
| `core/connectors/notion/` | Notion API клиент |
| `core/connectors/stt/` | Speech-to-text |
| `core/connectors/telegram/` | Telegram helpers |

### Claude Code специфичное
| Файл | Описание |
|------|----------|
| `docs/claude_code_notion_lessons.md` | Уроки по Notion API интеграции |

---

## Известные проблемы

1. **MCP Notion** — вложенные объекты сериализуются как строки → использовать curl
2. **Windows UTF-8** — русский текст через JSON файл, не inline в curl
3. **Database ID** — поиск может вернуть view, проверять `parent.database_id`

---

## Типы памяти в проекте (Postgres)

1. **Chat Memory** — история диалогов + summary
2. **Memory Suggestions** — кандидаты предпочтений (UX)
3. **Work Context Cache** — контекст из Notion для AI planner
4. **Event Log** — операционный лог для отладки

---

## Архитектура Agent Loop

```
Intent Router (LLM) → Planner (LLM) → Executor (код) → Guards (код)
```

- **Router** — классифицирует вход (задача, вопрос, обновить, удалить, идея, настройка)
- **Planner** — строит план шагов в JSON (`tool_calls[]`)
- **Executor** — выполняет tool calls детерминированно
- **Guards** — правила безопасности и UX

**Принцип:** LLM пишет план в JSON, выполнение — код.

---

## Антипаттерны (из pitfalls.md)

1. **JS regex + кириллица** — `\b` не работает с русскими словами (ASCII-only). Использовать `includes()` или regex без границ
2. **`\w` и `\W`** — ASCII-only. Для Unicode: `[\p{P}\p{S}\s]+` с флагом `u`
3. **Telegram polling** — не логировать целиком объект ошибки (утечка токена). Логировать только `code`, `message`, `description`
4. **Детерминированные эвристики для routing** — тупиковый путь. Использовать LLM Router + Planner

---

## Структура репозитория

```
apps/
  todo_bot/           # Telegram bot (polling)
  reminders_worker/   # Фоновые джобы
  diag/               # Диагностика

core/
  orchestrator/       # Router / Planner / Executor
  dialogs/            # FSM и клавиатуры
  tools/              # Tool Registry
  connectors/         # Интеграции
    telegram/
    notion/
    postgres/
    stt/
  ai/                 # LLM компоненты
  runtime/            # Dev runner, trace

infra/
  db/migrations/      # SQL миграции
  docker-compose.*.yml
```

---

## Ключевые переменные окружения

| Переменная | Описание |
|------------|----------|
| `TELEGRAM_BOT_TOKEN_*` | Токены для тестов/прода |
| `NOTION_TOKEN` | Notion API ключ |
| `NOTION_TASKS_DB_ID` | ID базы задач |
| `OPENAI_API_KEY` | OpenAI для AI |
| `TG_AI=1` | Включить AI режим |
| `TG_AI_MODEL` | Модель (gpt-4.1 / gpt-4.1-mini) |
| `TG_CHAT_MEMORY_ENABLED` | Chat memory (default true) |
| `TG_WORK_CONTEXT_MODE` | off/auto/always |

---

## Текущая версия

- **todo_bot:** v0.2.4 (см. `apps/todo_bot/package.json`)
- При изменениях — bump version!
