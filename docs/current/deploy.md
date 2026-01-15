# Деплой (production)

Этот документ описывает текущий процесс деплоя бота и воркера в production окружение.

## Архитектура production

- **Postgres** - база данных (контейнер `tg-multiagent-postgres`)
- **Todo Bot** - Telegram бот (контейнер `tg-multiagent-todo-bot`)
- **Reminders Worker** - воркер напоминаний (контейнер `tg-multiagent-reminders-worker`)

Все сервисы оркестрируются через `infra/docker-compose.prod.yml`.

## Быстрый деплой

### Одна команда

В корне репозитория на сервере:

```bash
bash infra/deploy/prod_deploy.sh
```

Скрипт автоматически:

1. Поднимает `postgres` и ждет `healthy`
2. Применяет миграции Postgres (идемпотентно, только новые)
3. Поднимает `todo_bot` и `reminders_worker`
4. Запускает healthcheck внутри контейнера `todo_bot`

### Ручной деплой (по шагам)

Если нужно больше контроля:

```bash
# 1. Поднять postgres
docker compose -f infra/docker-compose.prod.yml up -d postgres

# 2. Дождаться healthy (обычно 5-10 секунд)
docker compose -f infra/docker-compose.prod.yml ps

# 3. Применить миграции
bash infra/db/migrate.sh --apply

# 4. Поднять bot и worker
docker compose -f infra/docker-compose.prod.yml up -d todo_bot reminders_worker

# 5. Проверить логи
docker logs tg-multiagent-todo-bot --tail 50
docker logs tg-multiagent-reminders-worker --tail 50
```

## Переменные окружения (production)

Минимальный набор для `.env` на сервере:

```env
# Telegram
TELEGRAM_BOT_TOKEN_PROD=...
TG_BOT_MODE=prod

# Notion
NOTION_TOKEN=...
NOTION_TASKS_DB_ID=2d6535c900f08191a624d325f66dbe7c
NOTION_IDEAS_DB_ID=2d6535c900f080ea88d9cd555af22068
NOTION_SOCIAL_DB_ID=2d6535c900f080929233d249e1247d06
NOTION_JOURNAL_DB_ID=86434dfd454448599233c1832542cf79
NOTION_PREFERENCES_DB_ID=2d9535c900f081669a37f10ba1c31fc0
NOTION_PREFERENCE_PROFILES_DB_ID=2d9535c900f08127909bec232d8c99e0

# OpenAI (для AI режима)
OPENAI_API_KEY=...
TG_AI=1
TG_AI_MODEL=gpt-4.1

# Postgres (или используй дефолты из compose)
POSTGRES_DB=tg_multiagent
POSTGRES_USER=tg_multiagent
POSTGRES_PASSWORD=...

# Опционально: тестовая Tasks база
NOTION_TASKS_TEST_DB_ID=2d3535c900f0818ebc77fd1fd3d9d6fa
```

**Важно:** Все `NOTION_*_DB_ID` должны быть явно заданы в `.env`, иначе healthcheck будет показывать `fail`, даже если бот работает на дефолтных ID из кода.

## Проверка после деплоя

### В админ чате Telegram

- `/healthcheck` (или `/hc`) - должен показать `ok: true` для всех секций
  - В Notion секции видны хвосты DB ID (например, `(...dbe7c)`) для быстрой сверки
  - Если какая-то секция `fail` - смотри `info` в ответе

- `/healthcheck_json` - полный JSON отчет для детальной диагностики

### На сервере (CLI)

```bash
# Статус контейнеров
docker compose -f infra/docker-compose.prod.yml ps

# Логи бота
docker logs tg-multiagent-todo-bot --tail 200 --follow

# Логи воркера
docker logs tg-multiagent-reminders-worker --tail 200 --follow

# Healthcheck внутри контейнера бота
docker exec tg-multiagent-todo-bot node core/runtime/healthcheck.js
```

## Миграции Postgres

### Статус миграций

```bash
bash infra/db/migrate.sh --status
```

Показывает, какие миграции уже применены, а какие еще нет.

### Применить миграции

```bash
bash infra/db/migrate.sh --apply
```

Скрипт идемпотентный: можно запускать много раз, применятся только новые миграции.

### Ручное применение (если нужно)

```bash
docker exec -i tg-multiagent-postgres psql -U tg_multiagent -d tg_multiagent < infra/db/migrations/XXX_migration_name.sql
```

## Перезапуск сервисов

### Перезапуск бота (без потери состояния)

```bash
docker compose -f infra/docker-compose.prod.yml restart todo_bot
```

Или из админ чата:

- `/restart_polling` - перезапуск polling в текущем процессе
- `/restart_process confirm` - полный перезапуск процесса (остановка + запуск)

### Перезапуск воркера

```bash
docker compose -f infra/docker-compose.prod.yml restart reminders_worker
```

### Пересборка образов (после изменений кода)

```bash
docker compose -f infra/docker-compose.prod.yml build --no-cache
docker compose -f infra/docker-compose.prod.yml up -d
```

## Типовые проблемы

### Healthcheck показывает `fail` для Notion, но бот работает

**Причина:** Часть `NOTION_*_DB_ID` не задана в `.env`, бот использует дефолтные ID из кода, а healthcheck проверяет только env.

**Решение:**

1. Добавить все `NOTION_*_DB_ID` в `.env`
2. Перезапустить контейнеры: `docker compose -f infra/docker-compose.prod.yml restart todo_bot`
3. Проверить `/healthcheck` снова

### Миграции не применяются

**Причина:** Postgres еще не `healthy`, или проблемы с правами доступа.

**Решение:**

1. Проверить статус: `docker compose -f infra/docker-compose.prod.yml ps`
2. Проверить логи: `docker logs tg-multiagent-postgres --tail 50`
3. Попробовать применить миграции вручную (см. выше)

### Бот не отвечает после деплоя

**Причина:** Возможно, у бота все еще активен webhook, и polling конфликтует.

**Решение:**

1. Проверить логи: `docker logs tg-multiagent-todo-bot --tail 100`
2. Если видишь `409 Conflict` - нужно сбросить webhook через BotFather или API
3. Перезапустить бота: `/restart_polling` или `docker compose restart todo_bot`

## Дополнительные ресурсы

- Технический runbook: [docs/devops/deploy.md](../devops/deploy.md)
- Общая документация DevOps: [docs/devops/index.md](../devops/index.md)
- Healthcheck CLI: [docs/current/commands.md](./commands.md#healthcheck)

