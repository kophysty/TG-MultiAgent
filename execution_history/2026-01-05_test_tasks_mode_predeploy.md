# 2026-01-05 - Pre-deploy фиксы Docker + режим тестовой Tasks борды

## Цель

- Закрыть критичные блокеры для деплоя через `infra/docker-compose.prod.yml`:
  - voice пайплайн в контейнере требует ffmpeg
  - healthcheck должен работать из правильных путей внутри image
- Добавить безопасный режим "тестовых задач" для демо без засвета рабочих задач:
  - только через клавиатуру
  - per chat
  - без эвристик по тексту

## Что сделано

### Docker pre-deploy

- В Docker images добавлен ffmpeg (нужен для конвертации Telegram voice перед STT).
- В prod compose healthcheck переведен на абсолютный путь `node /app/core/runtime/healthcheck.js`, чтобы WORKDIR приложений не ломал проверки.

### Test tasks board mode (per chat)

- Если настроен `NOTION_TASKS_TEST_DB_ID`, в клавиатуре появляются кнопки:
  - `Тест задачи: ВКЛ`
  - `Тест задачи: ВЫКЛ`
- Режим хранится per chat в Postgres `preferences` (key: `tasks_board_mode`) если Postgres настроен.
- Когда режим включен, все операции с задачами (AI и команды `/today`, `/list`, `/addtask`) используют `NOTION_TASKS_TEST_DB_ID`.
- Ответы и списки в test режиме помечаются префиксом `[TEST TASKS]`, чтобы исключить смешивание с основной бордой.
- Reminders worker тестовую борду игнорирует и продолжает работать только с основной `NOTION_TASKS_DB_ID`.

## Файлы (high signal)

- `apps/todo_bot/src/main.js`
- `core/dialogs/todo_bot.js`
- `core/dialogs/todo_bot_executor.js`
- `core/dialogs/todo_bot_callbacks.js`
- `apps/todo_bot/Dockerfile`
- `apps/reminders_worker/Dockerfile`
- `infra/docker-compose.prod.yml`
- `docs/current/commands.md`
- `docs/current/index.md`

## Как проверить

1) Настроить env:

- `NOTION_TASKS_DB_ID` - основная Tasks база
- `NOTION_TASKS_TEST_DB_ID` - тестовая Tasks база

2) Запустить бота и нажать `Start`.

3) Включить test режим кнопкой `Тест задачи: ВКЛ`.

4) Создать задачу (AI или `/addtask`) и убедиться, что ответ содержит `[TEST TASKS]` и задача появилась в тестовой борде.

5) Выполнить `/today` и `/list` и убедиться, что данные берутся из тестовой борды и помечены `[TEST TASKS]`.

6) Нажать `Тест задачи: ВЫКЛ` и убедиться, что списки снова берутся из основной базы.

