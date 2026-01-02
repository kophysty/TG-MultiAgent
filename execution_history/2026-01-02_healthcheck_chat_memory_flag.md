# 2026-01-02 - Healthcheck CLI + chat_memory_enabled flag

## Цель

- Добавить CLI healthcheck для быстрого прогона окружения (Postgres, Notion, Telegram send).
- Добавить per chat_id флаг `chat_memory_enabled`, чтобы можно было отключать сбор диалоговой памяти в конкретном чате.

## Что сделано

### 1) chat_memory_enabled

- Новый preference key: `chat_memory_enabled`
- Default: включено (если preference отсутствует)
- Если `Active=false` или значение "off/false/0/нет" то:
  - bot не пишет user и assistant сообщения в `chat_messages`
  - worker не пересчитывает chat summary для этого chat_id

### 2) Healthcheck CLI

- Добавлен скрипт `core/runtime/healthcheck.js`
- Проверки:
  - Postgres: подключение и наличие ключевых таблиц
  - Notion: доступ к базам по env id
  - Telegram: best-effort sendMessage в admin chat (по `TG_ADMIN_CHAT_IDS` или `TG_HEALTHCHECK_CHAT_ID`)
- Документация:
  - `docs/current/commands.md`
  - `.cursor/commands/healthcheck.md`

## Как проверить

Только Postgres:

```bash
node core/runtime/healthcheck.js --postgres
```

Notion:

```bash
node core/runtime/healthcheck.js --notion
```

Telegram:

```bash
node core/runtime/healthcheck.js --telegram
```


