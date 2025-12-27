# TG-MultiAgent

Telegram агент, который работает с Notion как с первоисточником задач и документов и умеет оркестрировать инструменты (MCP, STT и т.д.) через детерминированный executor.

## Первоисточник (single source of truth)

- [Base structure (Notion)](https://www.notion.so/web3-future/Base-structure-2d1535c900f08016af17ca1d92c5c9de?t=2d3535c900f0805e884300a99586f20f)
- [Tasks Base MultiAgent (Notion DB, CRUD тесты)](https://www.notion.so/web3-future/2d6535c900f08191a624d325f66dbe7c?v=2d6535c900f08188b3cf000c5b8f5039)

Если в репозитории и Notion есть расхождение - сначала правим Notion, затем обновляем `docs/`.

## Документация в репозитории

- [docs/index.md](./docs/index.md)
- [execution_history/index.md](./execution_history/index.md)

## Боты

- **Prod**: `@my_temp_todo_bot`
- **Tests**: `@todofortests_bot`

В dev мы начинаем с polling (Bot API `getUpdates`): для этого достаточно токенов ботов в `.env`, отдельное подключение Telegram аккаунта не нужно.

## Dev: polling (как будем тестировать)

- **Что нужно**: токен бота (у тебя уже добавлены), локальный процесс, который опрашивает Telegram.
- **Важно**: у одного бота не должно быть одновременно активного webhook и polling consumer. Если бот раньше работал с webhook - сначала сбрось webhook.

## Docker (postgres + n8n)

Docker Compose лежит в `infra/docker-compose.yml`.

## TL;DR (что важно из Notion)

- **Notion** - первоисточник и витрина (Tasks, Ideas, Documents), правки вносим сначала там.
- **Postgres** - операционная память и главный индекс (state, jobs, memory/preferences, documents chunks + FTS + опционально `pgvector`).
- **Agent core** - мозг: Intent Router + Planner (строгий JSON plan) + Executor + Guards/Policies.
- **Tool Registry** - реестр инструментов, а не хардкод.
- **MCP для Notion** - лучше официальный: hosted `mcp.notion.com` или self-host `makenotion/notion-mcp-server`.
- **Voice UX** - прогресс через edit одного сообщения: "скачиваю" -> "конвертирую" -> "расшифровываю" -> "формирую задачу" -> "пишу в Notion" -> "готово".
- **Будущий UI** (web, extension, app) ходит в наш backend API, а не в Notion напрямую.

## Ключевые принципы

- **Docker first (для продакшена)**: один VPS, минимум магии, переносимость, легко добавить ffmpeg и Postgres.
- **N8N - это проводка, не мозг**: критичная логика и состояние живут в коде; n8n опционален.
- **Agent loop**: LLM строит план в структурированном JSON, код выполняет детерминированно (ретраи, таймауты, логи).
- **Memory**: предпочтения и операционное состояние храним в Postgres, Notion - витрина и первоисточник.

## Быстрые ссылки (docs)

- [docs/index.md](./docs/index.md)
- [docs/current/index.md](./docs/current/index.md)
- [docs/roadmap/index.md](./docs/roadmap/index.md)

Ключевые разделы roadmap:

- [Финальный сборочный лист](./docs/roadmap/final-checklist.md)
- [Стек и деплой](./docs/roadmap/stack-and-deploy.md)
- [AI-оркестрация](./docs/roadmap/agent-loop.md)
- [Tool Registry](./docs/roadmap/tool-registry.md)
- [Text и Voice пайплайны](./docs/roadmap/pipelines.md)

## Dev vs Prod

- **Dev (сейчас)**: код запускаем локально, зависимости (Postgres) можно поднимать в Docker по мере необходимости.
- **Prod (потом)**: собираем Docker Compose с `agent-core`, `worker`, `postgres` (и опционально n8n).

## Запуск (dev, polling, без AI)

1) Установить зависимости Node (todo bot):

```bash
cd apps/todo_bot
npm install
```

2) Настроить `.env`:

- Переменные (рекомендуется):
  - `TELEGRAM_BOT_TOKEN_TESTS` (для `@todofortests_bot`)
  - `TELEGRAM_BOT_TOKEN_PROD` (для `@my_temp_todo_bot`)
  - `NOTION_TOKEN`
  - `NOTION_TASKS_DB_ID` (по умолчанию `Tasks Base MultiAgent`: `2d6535c900f08191a624d325f66dbe7c`)
- Для совместимости с твоим текущим `.env` поддержан и "человеческий" формат: бот пытается извлечь токены из строк, где упоминаются `@todofortests_bot`, `@my_temp_todo_bot` и Notion.

3) Запустить бот:

```bash
cd apps/todo_bot
TG_BOT_MODE=tests npm start
```
