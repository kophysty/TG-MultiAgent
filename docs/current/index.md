# Текущее состояние (current)

Это документация по тому, что уже реально работает в репозитории `TG-MultiAgent` на данный момент.

## Версия

- Текущая версия todo bot: `v0.1.42`

## Разделы

- [AI (текущая реализация)](./ai.md)
- [Бот UI и команды (текущая реализация)](./bot-ui.md)
- [Команды бота (список)](./commands.md)
- [Voice режим (текущая реализация)](./voice.md)
- [Напоминалки (текущая реализация)](./reminders.md)
- [Memory и предпочтения (текущая реализация)](./memory.md)
- [Безопасность (sessions, notify, revoke)](./security.md)

## Компоненты

- `apps/todo_bot` - Telegram bot (polling) + Notion CRUD + AI (опционально).
- `core/connectors/notion` - Notion API клиент и репозитории (Tasks, Ideas, Social Media Planner, Journal).
- `core/dialogs/todo_bot.js` - команды и логика диалогов бота.
- `infra/docker-compose.yml` - Postgres и n8n (опционально, пока не обязательны).

## Переменные окружения (минимум)

- `TELEGRAM_BOT_TOKEN_TESTS` - токен тестового бота (`@todofortests_bot`).
- `TELEGRAM_BOT_TOKEN_PROD` - токен прод бота (`@my_temp_todo_bot`).
- `NOTION_TOKEN` - токен Notion integration.
- `NOTION_TASKS_DB_ID` - id базы задач (Tasks Base MultiAgent, current: `2d6535c900f08191a624d325f66dbe7c`).
- `NOTION_TASKS_TEST_DB_ID` - id тестовой базы задач (используется в режиме "Тест задачи", per chat).
- `NOTION_IDEAS_DB_ID` - id базы идей (Ideas DB, current: `2d6535c900f080ea88d9cd555af22068`).
- `NOTION_SOCIAL_DB_ID` - id базы Social Media Planner (current: `2d6535c900f080929233d249e1247d06`).
- `NOTION_JOURNAL_DB_ID` - id базы дневника Journal (current: `86434dfd454448599233c1832542cf79`).
- `NOTION_PREFERENCES_DB_ID` - id базы Preferences (current: `2d9535c900f081669a37f10ba1c31fc0`).
- `NOTION_PREFERENCE_PROFILES_DB_ID` - id базы Preference Profiles (current: `2d9535c900f08127909bec232d8c99e0`).
- `OPENAI_API_KEY` - ключ OpenAI (для AI режима).
- `TG_MEMORY_SYNC_SECONDS` - период синка memory (сек), default 1800.
- `TG_MEMORY_PUSH_BATCH` - размер пачки push в Notion за тик, default 20.

## Запуск (dev, polling)

```bash
cd apps/todo_bot
npm install
TG_BOT_MODE=tests TG_DEBUG=1 npm start
```

## AI режим (опционально)

AI включается флагом:

- `TG_AI=1`
- `TG_AI_MODEL=gpt-4.1` (по умолчанию в коде используется `gpt-4.1` если переменная не задана)

Пример запуска:

```bash
cd apps/todo_bot
TG_BOT_MODE=tests TG_DEBUG=1 TG_AI=1 TG_AI_MODEL=gpt-4.1 npm start
```

Примечание:

- Если хочешь использовать более легкую модель, можно указать `TG_AI_MODEL=gpt-4.1-mini`.

```bash
cd apps/todo_bot
TG_BOT_MODE=tests TG_DEBUG=1 TG_AI=1 TG_AI_MODEL=gpt-4.1-mini npm start
```

Поведение AI:

- Если сообщение похоже на вопрос - бот отвечает прямо в чат.
- Если сообщение похоже на задачу - бот извлекает поля, показывает summary, просит подтверждение.
- Подтверждение:
  - кнопкой "Подтвердить"
  - или текстом: "да", "подтверждаю", "подтвердить", "ок"
- Отмена:
  - кнопкой "Отмена"
  - или текстом: "нет", "отмена", "отменить"

## Категории задач (Tags)

- Список категорий берется динамически из Notion свойства `Tags` (options).
- `Deprecated`:
  - не показывается в меню выбора категории
  - не выбирается AI
  - задачи с этим тегом не выводятся в /list и /today
- Алиас `Today`:
  - в UI может показываться как `Today`
  - в Notion фактически пишем и читаем как `Inbox` (алиас Today -> Inbox)
- Если AI сомневается в категории - выбирает `Inbox`.
- Категория `Every Day` используется для периодических задач-напоминаний.


