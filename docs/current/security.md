# Безопасность (sessions, notify, revoke)

Этот документ описывает базовую безопасность Telegram бота в текущей реализации.

## Термины

- Session: в контексте Telegram Bot API это не "устройство", а факт, что бот общался с конкретным `chatId`.
- Telegram не дает надежного device id, поэтому мы опираемся на:
  - `chatId`
  - `chat.type`, `chat.title`
  - `from.id`, `from.username`
  - `first_seen_at`, `last_seen_at`

## Уведомления админам

Если бот впервые видит новый `chatId`, он отправляет уведомление в админские чаты.

Админские чаты задаются переменной:

- `TG_ADMIN_CHAT_IDS` - список chatId через запятую, например `123,456`

## Revoke (отключение чата)

Админ может отключить конкретный `chatId`.

Поведение:

- revoked чат продолжает обновлять `last_seen_at`, но все команды, AI и callback действия для него блокируются
- бот может отвечать в такой чат коротким сообщением, что чат отключен (с rate limit, чтобы не спамить)

## Команды админа

- `/sessions [N]` - список известных чатов (по `last_seen_at`, максимум 200)
- `/security_status` - статус security backend и базовая статистика
- `/revoke <chatId> [reason]` - отключить чат
- `/revoke_here [reason]` - отключить текущий чат
- `/unrevoke <chatId>` - включить чат обратно

## Хранилище данных

По умолчанию backend выбирается автоматически:

- если есть `POSTGRES_URL` - используется Postgres
- иначе используется файл

Настройка:

- `TG_SECURITY_STORE=auto|pg|file` (default `auto`)
- `TG_SECURITY_FILE_PATH` (для file режима), default `data/security/sessions.json`

## Миграции (Postgres)

Если используется Postgres, требуется применить миграцию:

- `infra/db/migrations/003_chat_security.sql`







