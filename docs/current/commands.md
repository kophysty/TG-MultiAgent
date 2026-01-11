# Команды бота (список)

Ниже перечислены команды, которые поддерживает бот в текущей реализации.

## Пользовательские команды

- `/start` - показать клавиатуру быстрых команд и версию бота
- `Start` - кнопка в клавиатуре, работает так же как `/start`
- `/today` - показать задачи на сегодня (по `TG_TZ`) плюс `Inbox` без due date или с due date не позже сегодняшнего дня (просроченные включаем)
- `/list` - показать активные задачи (по умолчанию без `Done` и без `Deprecated`)
- `/addtask` - ручной сценарий добавления задачи (без AI)
- `/struct` - показать структуру Tasks DB (свойства и типы)
- `/reminders_on` - включить напоминалки (нужен `POSTGRES_URL`)
- `/reminders_off` - выключить напоминалки (нужен `POSTGRES_URL`)
- `Тест задачи: ВКЛ` - включить режим тестовых задач (per chat, только через клавиатуру, кнопка появляется если задан `NOTION_TASKS_TEST_DB_ID`)
- `Тест задачи: ВЫКЛ` - выключить режим тестовых задач (вернуться к основной Tasks базе)

Примечания по тестовому режиму:

- В режиме ВКЛ все операции с задачами (включая AI CRUD и списки) идут в тестовую базу.
- Ответы и списки в тестовом режиме помечаются префиксом `[TEST TASKS]`.
- Reminders worker игнорирует тестовую базу и работает только с основной.

## Админские команды (security)

Эти команды доступны только чатам из `TG_ADMIN_CHAT_IDS`.

- `/cmnds` (алиас: `/commands`) - показать список админских команд (включая диагностику)
- `/model` - показать активные модели (AI, prefs extractor, STT) и подсказку по настройке
- `/prefs_pg` - показать preferences строго из Postgres (по текущему чату)
- `/errors [hours]` - последние ошибки из Postgres `event_log` по текущему чату (по умолчанию 24 часа)
- `/chat_history [N]` - показать последние N сообщений из chat memory (`chat_messages`) по текущему чату (по умолчанию 30)
- `/chat_find <text>` - поиск по chat memory (`chat_messages`) по текущему чату
- `/chat_at HH:MM [windowMin]` - показать сообщения около времени (пример: `/chat_at 04:11`)
- `/chat_summary HH:MM HH:MM` - саммари сообщений за диапазон времени (пример: `/chat_summary 02:00 03:00`)
- `/history_list 20` - список файлов в `execution_history/` (пример, можно указать N)
- `/history_show 3` - показать краткий конспект sprint файла по номеру из `/history_list`
- `/history_show 2026-01-05_test_tasks_mode_predeploy.md` - показать конспект sprint файла по имени
- `/history_summary 3` - summary по `execution_history/` за последние N дней (пример)
- `/sessions [N]` - список известных чатов (sessions)
- `/security_status` - статус security backend и статистика
- `/revoke <chatId> [reason]` - отключить чат
- `/revoke_here [reason]` - отключить текущий чат
- `/unrevoke <chatId>` - включить чат обратно

Примечание по моделям:

- По умолчанию модель задается через `TG_AI_MODEL` в `.env` (пример: `TG_AI_MODEL=gpt-5.1`).
- Для совместимости также поддерживается алиас `AI_MODEL`, но предпочтительно использовать `TG_AI_MODEL`.

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

JSON отчет:

```bash
node core/runtime/healthcheck.js --json
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

## Dev: diag bundle (для расследований)

Собирает диагностический bundle в `data/diag/` (папка в `.gitignore`).

Пример:

```bash
node apps/diag/src/main.js --chat-id 104999109 --since-hours 24
```

Опционально можно указать файл вывода:

```bash
node apps/diag/src/main.js --chat-id 104999109 --since-hours 24 --out data/diag/my-bundle.json
```

## Dev: evals (DevHarness для dataset прогонов planner)

Это dev инструмент для прогонов реального planner на наборе примеров (dataset) и отчета mismatch. Не является Telegram командой и не обязателен в CI.

Пример:

```bash
node apps/evals/src/main.js --dataset apps/evals/ds/sample.jsonl --only-mismatch
```

Если хочешь подтянуть allowedCategories из Notion Tasks DB:

```bash
node apps/evals/src/main.js --dataset apps/evals/ds/sample.jsonl --categories-from-notion
```

Примечание про большие прогоны:

- OpenAI может вернуть 429 (rate limit). Для устойчивости используй throttle и retry:

```bash
node apps/evals/src/main.js --dataset apps/evals/ds/01_2026-01-06_planner_150.jsonl --only-mismatch --sleep-ms 400 --retries 6 --retry-base-ms 1500
```





