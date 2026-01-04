# Команды бота (список)

Ниже перечислены команды, которые поддерживает бот в текущей реализации.

## Пользовательские команды

- `/start` - показать клавиатуру быстрых команд и версию бота
- `Start` - кнопка в клавиатуре, работает так же как `/start`
- `/today` - показать задачи на сегодня (по `TG_TZ`) плюс `Inbox`
- `/list` - показать активные задачи (по умолчанию без `Done` и без `Deprecated`)
- `/addtask` - ручной сценарий добавления задачи (без AI)
- `/struct` - показать структуру Tasks DB (свойства и типы)
- `/reminders_on` - включить напоминалки (нужен `POSTGRES_URL`)
- `/reminders_off` - выключить напоминалки (нужен `POSTGRES_URL`)

## Админские команды (security)

Эти команды доступны только чатам из `TG_ADMIN_CHAT_IDS`.

- `/sessions [N]` - список известных чатов (sessions)
- `/security_status` - статус security backend и статистика
- `/revoke <chatId> [reason]` - отключить чат
- `/revoke_here [reason]` - отключить текущий чат
- `/unrevoke <chatId>` - включить чат обратно

## Dev команды (healthcheck)

Это не Telegram команды, а команды для проверки окружения перед запуском.

Запускать из корня репозитория:

- Проверить Postgres и Notion:

```bash
node core/runtime/healthcheck.js
```

- Только Postgres:

```bash
node core/runtime/healthcheck.js --postgres
```

- Только Notion:

```bash
node core/runtime/healthcheck.js --notion
```

- Telegram send (best-effort в admin chat):

```bash
node core/runtime/healthcheck.js --telegram
```

## Dev: запуск bot и worker одной командой

Запускать из корня репозитория:

```bash
node core/runtime/dev_runner.js --tests --debug --ai
```

Остановить: Ctrl+C в том же терминале.

## Docker (prod): запуск bot + worker + postgres

Файл: `infra/docker-compose.prod.yml`

Запуск:

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```





