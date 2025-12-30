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

Таблицы:

- `preferences` - текущие предпочтения (source of truth для prompt)
- `preferences_sync` - метаданные синка (pageId, last hashes, last seen notion edit time)
- `notion_sync_queue` - очередь write-through апдейтов в Notion с ретраями

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


