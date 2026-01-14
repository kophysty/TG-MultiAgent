---
name: 12_2026-01-13_predeploy_readiness
overview: "Подготовка проекта к прод деплою: исправить Docker сборку (зависимости core), ускорить build context через .dockerignore, описать миграции, добавить admin команды healthcheck и reboot в боте, и вынести админский блок из todo_bot.js."
todos:
  - id: docker-core-deps
    content: Обновить Dockerfile-ы bot и worker, чтобы ставились зависимости core (npm ci в /app/core)
    status: completed
  - id: dockerignore
    content: Добавить .dockerignore в корень и исключить node_modules, data и прочие лишние директории
    status: completed
  - id: pg-migrations-runbook
    content: Описать и/или автоматизировать применение миграций Postgres перед стартом prod compose
    status: completed
  - id: admin-healthcheck-cmds
    content: Добавить admin команды /healthcheck(/hc) и /healthcheck_json в todo bot, переиспользовав core/runtime/healthcheck
    status: completed
  - id: admin-reboot-cmds
    content: Добавить admin команды /restart_polling и /restart_process confirm, добавить их в /cmnds
    status: completed
    dependencies:
      - admin-healthcheck-cmds
  - id: refactor-admin-module
    content: Вынести admin команды и диагностику из core/dialogs/todo_bot.js в отдельный модуль core/dialogs/todo_bot_admin.js
    status: completed
    dependencies:
      - admin-healthcheck-cmds
  - id: docs-and-version
    content: Обновить docs/current и devops доки, CHANGELOG/HISTORY/execution_history, bump версии todo_bot
    status: completed
    dependencies:
      - docker-core-deps
      - admin-healthcheck-cmds
      - admin-reboot-cmds
---

# План подготовки к деплою (predeploy readiness)

## Цели

- Сделать docker-compose prod запуск воспроизводимым: контейнеры стартуют без зависимости от локальных `node_modules`.
- Дать админам возможность из Telegram получить диагностику (healthcheck) и инициировать перезапуск бота.
- Снизить риск регрессий за счет понятного runbook по миграциям и меньшего монолита `todo_bot.js`.

## Обнаруженные блокеры и риски

- **Блокер - зависимости `core` в Docker**: сейчас в `apps/todo_bot/Dockerfile` и `apps/reminders_worker/Dockerfile` ставятся зависимости только конкретного приложения, но код активно импортирует модули из `core` (например `pg`). В чистом контейнере это приведет к падению при `require('pg')`.
- **Риск - большой build context**: в репозитории есть `node_modules/`, а `.dockerignore` отсутствует. Build context может раздуваться и замедлять сборку.
- **Риск - миграции Postgres**: `infra/db/migrations/*.sql` должны быть применены до запуска, иначе healthcheck и часть функций (memory, event_log, sync queue) не заведутся.

## Изменения (код)

### 1) Docker - установка зависимостей `core`

- Обновить Dockerfile-и:
- [`apps/todo_bot/Dockerfile`](apps/todo_bot/Dockerfile)
- [`apps/reminders_worker/Dockerfile`](apps/reminders_worker/Dockerfile)

Идея:

- Копировать `core/package.json` и `core/package-lock.json` отдельно
- Выполнить `npm ci --omit=dev` в `/app/core`
- Затем копировать исходники `core/` и `apps/*/src`

Ожидаемый результат:

- Контейнеры запускаются и проходят healthcheck без локальных `node_modules`.

### 2) Docker - добавить `.dockerignore` (в корень)

- Добавить файл `.dockerignore` (в корень репозитория, по согласованию).

Минимальный набор исключений:

- `**/node_modules/`
- `data/`
- `execution_history/` (опционально, если не требуется в контейнере)
- `.git/`
- `.cursor/` (кроме уже трекаемых файлов)

Ожидаемый результат:

- Быстрые и стабильные docker build в CI и на сервере.

### 3) Runbook миграций Postgres

- Зафиксировать инструкцию деплоя:
- какие миграции обязательны (`infra/db/migrations/*.sql`)
- как применить миграции на сервере
- как проверить (через `node /app/core/runtime/healthcheck.js --postgres`)

Вариант реализации:

- **Документация + ручной шаг** (самый простой)
- Или добавить отдельный helper в `infra/` (например сервис `migrator` в compose или скрипт `infra/db/migrate.sh`) - если решим автоматизировать.

### 4) Admin команды в боте: healthcheck и reboot

- Добавить admin-only команды в [`core/dialogs/todo_bot.js`](core/dialogs/todo_bot.js) через вынос в отдельный модуль:
- `/healthcheck` (алиас `/hc`): показать краткий статус Postgres + Notion, и ключевые таблицы.
- `/healthcheck_json`: вернуть JSON (удобно копировать в тикет).
- `/restart_polling`: перезапуск polling внутри процесса.
- `/restart_process confirm`: завершить процесс после ответа, чтобы оркестратор (docker restart policy) поднял его заново.

Реализация healthcheck:

- Вынести текущий CLI [`core/runtime/healthcheck.js`](core/runtime/healthcheck.js) в библиотечный модуль (например `core/runtime/healthcheck_lib.js`) и переиспользовать его и из CLI, и из бота.
- Либо запускать CLI через `child_process` и парсить stdout (менее предпочтительно).

Ограничения:

- Команды только для `TG_ADMIN_CHAT_IDS`.
- Результаты должны быть краткими и без утечек секретов.

### 5) Рефакторинг `todo_bot.js`

- Вынести админский блок (healthcheck, reboot, chat memory admin команды, history команды) в отдельный файл, например:
- `core/dialogs/todo_bot_admin.js`

Цель:

- Сохранить текущую структуру (voice, helpers, callbacks, executor уже вынесены), но разгрузить `todo_bot.js` и упростить поддержку.

### 6) Документация и версия

- Обновить:
- [`docs/current/commands.md`](docs/current/commands.md) - добавить новые admin команды.
- `docs/devops/` или `README.md` - секцию про деплой, миграции и docker build.
- Bump версии `apps/todo_bot/package.json` (функциональные изменения) и синхронизировать `docs/current/index.md`.
- Добавить запись в `CHANGELOG.md`, `HISTORY.md` и `execution_history/`.

## Проверки перед деплоем

- Локально (или в CI):
- `docker compose -f infra/docker-compose.prod.yml build`
- `docker compose -f infra/docker-compose.prod.yml up -d`
- `node core/runtime/healthcheck.js --postgres --notion`
- В Telegram (admin чат): `/healthcheck`, затем `/restart_polling`.

## Rollout

- Сначала деплоим на staging или в тестовый токен.
- Проверяем healthcheck и базовые CRUD сценарии.
- Затем включаем prod токен.