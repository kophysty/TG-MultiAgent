# AGENTS.md — Структура агентов и правила работы

## Правила проекта для агентов

> Источники: `.cursor/rules/base-agent-rules.mdc`, `.cursor/rules/terminal-policy.mdc`

### Базовые правила

1. **Никогда не сохранять файлы в корне проекта** — использовать подходящие поддиректории
2. **Никогда не делать rollback/revert/reset** без явного согласования с пользователем
3. **В чате говорим на русском**
4. **Документация на русском**
5. **Bump version** при функциональных изменениях (`apps/todo_bot/package.json`)
6. **Notion MCP** — использовать `data_source_id`, не `database_id` из URL
7. **Планы в `.cursor/plans/`** — с порядковым номером и датой в имени
8. **Имена файлов** — без заглавных букв, следовать стилю папки
9. **Логи** — никогда не удалять без явного одобрения, даже если спринт завершен

### Правила работы с терминалом

- **Приоритет 1**: Git Bash для всех команд, чтения и редактирования
- **Приоритет 2**: WSL Ubuntu Bash как fallback, если Git Bash недоступен
- **Не использовать** PowerShell или cmd, кроме явного разрешения пользователя
- **UTF-8 везде**: устанавливать `LANG=C.UTF-8 LC_ALL=C.UTF-8` для скриптов с кириллицей
- **Пути**: Windows `D:\...` ↔ WSL `/mnt/d/...`

---

## Архитектура Agent Loop

```
Intent Router (LLM) → Planner (LLM) → Executor (код) → Guards (код)
```

### Компоненты

- **Router** — классифицирует вход (задача, вопрос, обновить, удалить, идея, настройка) и возвращает confidence
- **Planner** — строит план шагов в JSON (`tool_calls[]`) с указанием инструментов, порядка и параметров
- **Executor** — выполняет tool calls детерминированно, с ретраями, таймаутами и логированием
- **Guards/Policies** — правила безопасности и UX (подтверждения для delete, low-confidence → уточнения, таймаут → Inbox)

**Ключевой принцип:** LLM пишет план в JSON, выполнение — детерминированный код.

---

## Структура файлов агентов

### Текущая реализация

| Путь | Описание |
|------|----------|
| `core/ai/agent_planner.js` | Planner — строит план tool calls из LLM |
| `core/ai/todo_intent.js` | Intent Router — классифицирует вход (question/task) |
| `core/ai/confirm_intent.js` | Подтверждение намерений пользователя |
| `core/ai/openai_client.js` | Клиент для OpenAI API |
| `core/ai/chat_summarizer.js` | Суммаризация истории чата |
| `core/ai/preference_extractor.js` | Извлечение предпочтений из диалога |

### Планируемая структура (из roadmap)

```
core/
  orchestrator/             # Router / Planner / Executor / Policies
    router.*                # Intent Router
    planner.*               # Agent Planner
    executor.*              # Tool Executor
    policies.*              # Guards и правила безопасности

  dialogs/                  # FSM и клавиатуры
    flows/                  # Сценарии диалогов
    keyboards/              # Билдеры inline-кнопок

  tools/                    # Tool Registry (то, что выбирает Planner)
    registry.*              # Реестр инструментов
    telegram_tools.*        # Telegram инструменты
    notion_tools.*          # Notion инструменты
    stt_tools.*             # Speech-to-text инструменты

  connectors/               # Интеграции (реализация tool-ов)
    telegram/               # Telegram API клиент
    notion/                 # Notion API клиент
    postgres/               # Postgres репозитории
    stt/                    # STT pipeline
```

---

## Tool Registry

Инструменты должны быть в реестре, а не хардкодом. Planner выбирает tool-ы из списка и параметризует их.

### Примеры инструментов

- `telegram.update_status` — обновление статуса в чате
- `telegram.ask_clarify` — запрос уточнений у пользователя
- `stt.transcribe` — расшифровка голосового сообщения
- `notion.tasks.create/update/delete/query` — работа с задачами в Notion
- `notion.ideas.create` — создание идей
- `memory.save/get` — работа с памятью
- `docs.ingest/search/quote` — работа с документами

### Нормализация аргументов

Planner нормализует аргументы tool calls:
- Алиасы ключей: `page_id` → `pageId`, `task_index` → `taskIndex`, `query` → `queryText`
- Специфичные нормализации по имени инструмента (например, `notion.list_tasks` с датами)

---

## Типы агентов (планируемая архитектура)

### Схема 1: Один AI Planner (текущая)

- Один AI planner с большим набором инструментов
- Детерминированные ветки для команд `/...` и security checks
- Специальные гейты для UX и безопасности

**Минусы:**
- Planner видит сразу много доменов и tools
- Растет вероятность промаха в выборе tool или аргументов
- Если UX сценарий не активирован, модель может "сказать" вместо "сделать"

### Схема 2: Оркестратор + субагенты (планируется)

```
Telegram msg
  -> (voice?) STT -> text
  -> security check (admin?)
  -> if "/command" -> command handler (deterministic)
  -> else:
       -> (optional) safety pre-gates
       -> Orchestrator (router model):
             -> chooses 1 domain agent:
                  - TasksAgent (tools: list/create/update/done/deprecate)
                  - SocialAgent (tools: social list/create/update/archive)
                  - IdeasAgent
                  - JournalAgent
                  - MemoryAgent (chat summary/find/chat_at, prefs, etc)
             -> chosen agent plans + calls its small toolset
             -> result -> bot reply
```

**Преимущества:**
- Каждый агент видит только свой маленький набор tools
- Меньше неоднозначностей и меньше шансов выбрать не тот домен
- Ощущение "магии" за счет узкой специализации

**Что остается детерминированным:**
- Telegram команды `/...`
- Security check (admin-only)
- Часть safety и UX гейтов, где важнее надежность, чем "интуиция" модели

---

## Антипаттерны для агентов

> Источник: `docs/devops/pitfalls.md`

### 1. JS regex + кириллица

**Проблема:** `\b` не работает с русскими словами (ASCII-only)

**Решение:** Использовать `includes()` или regex без границ, или Unicode-aware границы `[\p{P}\p{S}\s]+` с флагом `u`

### 2. `\w` и `\W` — ASCII-only

**Проблема:** Кириллица не считается `\w`, поэтому `\W*` может удалить русские слова

**Решение:** Не использовать `\W` и `\w` для разборов на русском. Для Unicode: `[\p{P}\p{S}\s]+` с флагом `u`

### 3. Telegram polling — утечка токена

**Проблема:** Логирование целиком объекта ошибки может привести к утечке токена

**Решение:** Логировать только `code`, `message`, `description`

### 4. Детерминированные эвристики для routing

**Проблема:** Тупиковый путь для сложных сценариев

**Решение:** Использовать LLM Router + Planner вместо хардкода правил

---

## Документация агентов

| Файл | Описание |
|------|----------|
| `docs/roadmap/agent-loop.md` | Архитектура Agent Loop |
| `docs/roadmap/tool-registry.md` | Правила Tool Registry |
| `docs/roadmap/repo-structure.md` | Структура репозитория для агентов |
| `docs/roadmap/responsibilities.md` | Разделение обязанностей (Core vs N8N vs Workers) |
| `docs/devops/pitfalls.md` | Антипаттерны и как их избежать |
| `docs/current/deploy.md` | Деплой в production (текущее состояние) |
| `.cursor/plans/09_2026-01-12_subagents_orch_*.plan.md` | План по субагентам и оркестратору |
| `.cursor/plans/10_2026-01-12_orchestrator_refactor_*.plan.md` | План по рефакторингу оркестратора |

---

## Переменные окружения для агентов

| Переменная | Описание |
|------------|----------|
| `TG_AI=1` | Включить AI режим |
| `TG_AI_MODEL` | Модель (gpt-4.1 / gpt-4.1-mini) |
| `OPENAI_API_KEY` | OpenAI для AI компонентов |
| `TG_CHAT_MEMORY_ENABLED` | Chat memory (default true) |
| `TG_WORK_CONTEXT_MODE` | off/auto/always — режим работы с контекстом |

---

## Принципы работы агентов

1. **Детерминизм там, где возможно** — команды, security checks, простые валидации
2. **LLM для сложных решений** — классификация интентов, планирование шагов, извлечение структурированных данных
3. **Tool Registry** — единый реестр инструментов, доступных для Planner
4. **Guards всегда** — проверки безопасности и UX перед выполнением действий
5. **Нормализация аргументов** — унификация параметров tool calls от разных моделей
6. **Логирование** — все tool calls логируются для отладки и аудита

---

## Текущая версия

- **todo_bot:** v0.2.4 (см. `apps/todo_bot/package.json`)
- При изменениях в агентах — bump version!

