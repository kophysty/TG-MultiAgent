# Текущее состояние (current)

Это документация по тому, что уже реально работает в репозитории `TG-MultiAgent` на данный момент.

## Разделы

- [AI (текущая реализация)](./ai.md)
- [Бот UI и команды (текущая реализация)](./bot-ui.md)
- [Voice режим (текущая реализация)](./voice.md)
- [Напоминалки (текущая реализация)](./reminders.md)

## Компоненты

- `apps/todo_bot` - Telegram bot (polling) + Notion CRUD + AI (опционально).
- `core/connectors/notion` - Notion API клиент и репозиторий задач.
- `core/dialogs/todo_bot.js` - команды и логика диалогов бота.
- `infra/docker-compose.yml` - Postgres и n8n (опционально, пока не обязательны).

## Переменные окружения (минимум)

- `TELEGRAM_BOT_TOKEN_TESTS` - токен тестового бота (`@todofortests_bot`).
- `TELEGRAM_BOT_TOKEN_PROD` - токен прод бота (`@my_temp_todo_bot`).
- `NOTION_TOKEN` - токен Notion integration.
- `NOTION_TASKS_DB_ID` - id базы задач (Tasks Base MultiAgent, current: `2d6535c900f08191a624d325f66dbe7c`).
- `OPENAI_API_KEY` - ключ OpenAI (для AI режима).

## Запуск (dev, polling)

```bash
cd apps/todo_bot
npm install
TG_BOT_MODE=tests TG_DEBUG=1 npm start
```

## AI режим (опционально)

AI включается флагом:

- `TG_AI=1`
- `TG_AI_MODEL=gpt-4.1-mini`

Пример запуска:

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


