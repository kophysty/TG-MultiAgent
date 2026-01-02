# Memory и предпочтения (текущая реализация)

Цель - хранить предпочтения пользователя в Postgres (быстро читать и подмешивать в prompt), при этом иметь "витрину" и ручное редактирование через Notion.

## Источники и приоритет

- Postgres - быстрый слой для чтения и инъекции в AI planner.
- Notion - UI для ручного редактирования.
- При конфликте приоритет у Notion: если пользователь изменил preference в Notion, воркер применит это в Postgres.

## Notion структуры

Страница: [User-preferences](https://www.notion.so/web3-future/User-preferences-2d6535c900f080bda11afb55570e674c?t=2d8535c900f080de859b00a97357180a)

### Preferences (DB)

База Preferences хранит атомарные предпочтения.

Ключевые поля:

- `Key` (title) - ключ предпочтения, например `timezone`, `daily_digest_silent`
- `ExternalId` (rich_text) - стабильный id, формат: `pref:<chat_id>:<scope>:<key>`
- `ChatId` (number) - Telegram chat id
- `Scope` (select) - `global` или `project`
- `Category` (select) - `lifestyle|work|dev|content|other`
- `Active` (checkbox) - активно ли предпочтение
- `ValueHuman` (rich_text) - короткое значение для чтения
- `ValueJson` (rich_text) - значение в виде текста (JSON строкой или просто строка)
- `UpdatedAt` (date) - время последнего обновления (best-effort)
- `SyncHash` (rich_text) - хеш нормализованного значения (best-effort)
- `LastSource` (select) - `notion|postgres` (best-effort)

### Preference Profiles (DB)

База Preference Profiles хранит сводку предпочтений для каждого чата.

Ключевые поля:

- `ExternalId` (rich_text) - `profile:<chat_id>`
- `ChatId` (number)
- `Summary` (rich_text) - короткая сводка (10-30 строк)
- `UpdatedAt` (date)

## Postgres структуры

Миграции:

- `infra/db/migrations/003_preferences.sql`
- `infra/db/migrations/004_preferences_sync.sql`
- `infra/db/migrations/005_notion_sync_queue.sql`
- `infra/db/migrations/006_chat_memory.sql`

Таблицы:

- `preferences` - текущие предпочтения (source of truth для prompt)
- `preferences_sync` - метаданные синка (pageId, last hashes, last seen notion edit time)
- `notion_sync_queue` - очередь write-through апдейтов в Notion с ретраями
- `chat_messages` - сообщения чата (user и assistant), уже sanitized
- `chat_summaries` - короткая сводка чата для восстановления контекста (обновляется воркером)

## Chat memory (диалоговая память)

### Что сохраняем

- В `apps/todo_bot`:
  - входящие текстовые сообщения пользователя пишем в `chat_messages` (включая команды)
  - исходящие сообщения бота пишем в `chat_messages` через proxy вокруг `bot.sendMessage`
  - voice: после STT сохраняем transcript как user сообщение (best-effort)

Текст перед записью проходит sanitize для storage: удаляем токены и ключи (Telegram, Notion, OpenAI, Bearer).

### Chat summary

- В `apps/reminders_worker` периодически запускается `chatSummaryTick`:
  - выбирает чаты, где появились новые сообщения
  - обновляет `chat_summaries.summary`
  - чистит старые `chat_messages` по TTL

### Инъекция в AI planner

Перед вызовом `planAgentAction` бот подмешивает:

- preferences summary (как раньше)
- chat summary (если есть)
- последние N сообщений чата (короткий one-line формат)

### Переменные окружения (chat memory)

- `TG_CHAT_MEMORY_ENABLED` - включить/выключить chat memory, default true
- `TG_CHAT_MEMORY_LAST_N` - сколько последних сообщений читать, default 50
- `TG_CHAT_MEMORY_TTL_DAYS` - TTL для `chat_messages`, default 30

### Переменные окружения (chat summary)

- `TG_CHAT_SUMMARY_ENABLED` - включить/выключить chat summary tick, default true
- `TG_CHAT_SUMMARY_SECONDS` - период summary tick, default 900
- `TG_CHAT_SUMMARY_BATCH` - сколько чатов обрабатывать за тик, default 3
- `TG_CHAT_SUMMARY_MODEL` - модель для summary, default `gpt-4.1-mini`

### Управление сбором памяти per chat_id

Сбор chat memory можно отключить для конкретного чата через Preferences (Notion UI).

- key: `chat_memory_enabled`
- если preference не задан, то по умолчанию сбор включен
- если `Active=false` или значение "off/false/0/нет" то сбор user и assistant сообщений в `chat_messages` отключается и worker не будет пересчитывать summary

## Preference suggestions (предложение сохранить preference)

Иногда пользователь пишет устойчивые предпочтения не в явном виде "запомни". В этом случае бот может предложить сохранить preference кнопками.

### Как работает

- Бот запускает preference extractor (LLM) по эвристикам (не на каждое сообщение).
- Если найден кандидат с достаточной уверенностью, бот создает запись в Postgres `memory_suggestions` и показывает inline кнопки:
  - `Сохранить`
  - `Не сохранять`
- При `Сохранить`:
  - preference сохраняется в Postgres `preferences`
  - создается задача в `notion_sync_queue` вида `pref_page_upsert`, чтобы воркер отправил preference в Notion UI

### Переменные окружения

- `TG_PREF_EXTRACTOR_ENABLED` - включить/выключить extractor, default true
- `TG_PREF_EXTRACTOR_MODEL` - модель для extractor, default `gpt-4.1-mini`

## Work context cache (контекст из Notion для planner)

Для запросов типа "что делать дальше" или "составь план" полезно подмешивать актуальный список задач, идей и постов из Notion.

### Как работает

- Reminders worker периодически собирает контекст из Notion и сохраняет в Postgres `work_context_cache` строго per `chat_id`.
- Todo bot при `TG_WORK_CONTEXT_MODE=auto` подмешивает этот контекст в planner только для "discussion/analysis" сообщений (эвристика).

### Переменные окружения (worker)

- `TG_WORK_CONTEXT_ENABLED` - включить/выключить tick, default true
- `TG_WORK_CONTEXT_SECONDS` - период обновления, default 1800 (30 минут)
- `NOTION_IDEAS_DB_ID` - Ideas DB id
- `NOTION_SOCIAL_DB_ID` - Social DB id

### Переменные окружения (bot)

- `TG_WORK_CONTEXT_MODE` - `off|auto|always`, default `auto`
- `TG_WORK_CONTEXT_MAX_AGE_MIN` - максимальный возраст кэша для инжекта, default 720 (12 часов)

## Воркер: синхронизация

В `apps/reminders_worker` добавлен периодический memory tick:

- Pull: читает изменения из Notion Preferences DB и применяет в Postgres (Notion wins)
- Push: обрабатывает `notion_sync_queue` и обновляет Notion (write-through, с backoff)
- Обновляет `Preference Profiles` (сводка) после изменений

Частота: задается `TG_MEMORY_SYNC_SECONDS` (по умолчанию 1800 секунд, то есть 30 минут).

## Инъекция в AI planner

Перед вызовом planner бот читает preferences для `chat_id` из Postgres и подмешивает краткую сводку в контекст.
Это влияет на то, как LLM строит план tool calls и формулирует ответы.

## Переменные окружения

- `NOTION_PREFERENCES_DB_ID` - id базы Preferences
- `NOTION_PREFERENCE_PROFILES_DB_ID` - id базы Preference Profiles
- `TG_MEMORY_SYNC_SECONDS` - период синка (сек), default 1800
- `TG_MEMORY_PUSH_BATCH` - максимум задач очереди push за тик, default 20


