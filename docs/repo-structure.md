# Структура репозитория (чтобы совпадало с логикой Flow)

Ниже пример структуры (можно под Python или Node/TS, смысл одинаковый):

```text
apps/
  bot_api/                  # webhook входящих апдейтов + health
  worker/                   # фоновые джобы (очереди/cron)

core/
  orchestrator/             # Router / Planner / Executor / Policies
    router.*
    planner.*
    executor.*
    policies.*

  dialogs/                  # FSM и клавиатуры
    state_store.*           # Postgres or Redis adapter
    flows/                  # сценарии диалогов
      create_task.*
      update_task.*
    keyboards/              # билдеры inline-кнопок
      categories.*
      priorities.*
      dates.*
      common.*

  tools/                    # Tool Registry (то, что выбирает Planner)
    registry.*
    telegram_tools.*
    notion_tools.*
    stt_tools.*
    calendar_tools.*
    email_tools.*

  connectors/               # интеграции (реализация tool-ов)
    telegram/
      client.*              # sendMessage/editMessageText/answerCallback
      parse_update.*        # normalize update
    notion/
      mcp_client.*          # MCP клиент или Notion API
      tasks_repo.*
    stt/
      pipeline.*            # download -> ffmpeg -> transcribe
    calendar/
    email/

  storage/
    postgres.*
    migrations/

infra/
  docker-compose.yml
  n8n/                      # опционально: экспортированные workflow + env шаблоны
```

Как это мапится на N8N Flow:

- Telegram Trigger / Webhook -> `apps/bot_api`
- Switch/Router -> `core/orchestrator/router.*`
- Edit Fields / Set / IF -> `core/dialogs/*` + `core/domain/*` (валидации)
- Notion/Calendar/Email nodes -> `core/connectors/*` (или вызовы наружу через n8n)
- Send Message / Edit Message -> `connectors/telegram/client.*`


