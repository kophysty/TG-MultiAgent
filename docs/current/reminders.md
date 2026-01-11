# Напоминалки (текущая реализация)

Этот раздел описывает текущую реализацию напоминалок, которые бот присылает в Telegram на основе базы задач в Notion.

## Как это работает

- Бот (`apps/todo_bot`) по команде `/start` (или `/reminders_on`) сохраняет подписку чата в Postgres.
- Отдельный процесс `apps/reminders_worker`:
  - опрашивает базу задач Notion
  - рассчитывает, какие напоминания нужно отправить
  - отправляет сообщения в Telegram
  - сохраняет факт отправки в Postgres (чтобы не было дублей)

## Правила напоминаний (по умолчанию)

Таймзона: `TG_TZ` (по умолчанию `Europe/Moscow`).

- Ежедневный дайджест в `TG_REMINDERS_DAILY_AT` (по умолчанию `11:00`):
  - задачи, у которых due date попадает в текущие сутки (в `TG_TZ`), включая due datetime с временем
  - плюс задачи из `Inbox` без due date или с due date не позже сегодняшнего дня (просроченные включаем)
  - исключаем `Done` и `Deprecated`
  - формат: отдельные блоки "С дедлайном сегодня" и "Inbox"
  - включает блок "Посты сегодня" из Social Media Planner (исключаем `Published` и `Cancelled`)
  - отправляется без звука (silent) в Telegram

- Для задач с due date без времени (date-only):
  - напоминание накануне события в `TG_REMINDERS_DAY_BEFORE_AT` (по умолчанию `23:00`)
  - берутся задачи, у которых due date = завтра и поле due date не содержит времени
  - также включает посты из Social Media Planner на завтра без времени (date-only), исключая `Published` и `Cancelled`

- Для задач с due date и временем:
  - напоминание за `TG_REMINDERS_BEFORE_MINUTES` минут (по умолчанию `60`) до due datetime
  - также напоминание за `TG_REMINDERS_BEFORE_MINUTES` минут до `Post date` для постов из Social Media Planner (исключая `Published` и `Cancelled`)

## Дедупликация (без дублей)

В Postgres ведется таблица `sent_reminders` с уникальным ключом:

- `(chat_id, page_id, reminder_kind, remind_at)`

Если worker перезапустится, он не будет повторно слать уже отправленные напоминания.

## Переменные окружения

- `POSTGRES_URL` - строка подключения к Postgres (обязательно для напоминалок).
- `TG_TZ` - таймзона (по умолчанию `Europe/Moscow`).
- `TG_REMINDERS_DAILY_AT` - время дайджеста (по умолчанию `11:00`).
- `TG_REMINDERS_DAY_BEFORE_AT` - время напоминания накануне (по умолчанию `23:00`).
- `TG_REMINDERS_BEFORE_MINUTES` - минут до события (по умолчанию `60`).
- `TG_REMINDERS_POLL_SECONDS` - период опроса worker (по умолчанию `60`).

## Запуск (dev)

1) Поднять Postgres:

- `docker compose -f infra/docker-compose.yml up -d postgres`

2) Создать таблицы (миграции):

- Выполнить SQL из `infra/db/migrations/001_subscriptions.sql`
- Затем из `infra/db/migrations/002_sent_reminders.sql`

3) Запустить бота и подписаться:

- `cd apps/todo_bot`
- `TG_BOT_MODE=tests TG_DEBUG=1 TG_AI=1 npm start`
- В Telegram: `/start` или `/reminders_on`

4) Запустить worker:

- `cd apps/reminders_worker`
- `TG_BOT_MODE=tests npm start`


