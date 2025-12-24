# TG-MultiAgent

Telegram агент, который работает с Notion как с первоисточником задач и документов и умеет оркестрировать инструменты (MCP, STT и т.д.) через детерминированный executor.

## Первоисточник (single source of truth)

- [Base structure (Notion)](https://www.notion.so/web3-future/Base-structure-2d1535c900f08016af17ca1d92c5c9de?t=2d3535c900f0805e884300a99586f20f)

Если в репозитории и Notion есть расхождение - сначала правим Notion, затем обновляем `docs/`.

## Документация в репозитории

- [docs/index.md](./docs/index.md)
- [execution_history/index.md](./execution_history/index.md)

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

- [Финальный сборочный лист](./docs/final-checklist.md)
- [Стек и деплой](./docs/stack-and-deploy.md)
- [Разделение обязанностей](./docs/responsibilities.md)
- [AI-оркестрация](./docs/agent-loop.md)
- [Postgres](./docs/postgres.md)
- [Tool Registry](./docs/tool-registry.md)
- [Notion и MCP](./docs/notion-mcp.md)
- [Text и Voice пайплайны](./docs/pipelines.md)
- [Статусы в чате](./docs/chat-statuses.md)
- [Документы и поиск](./docs/documents-and-search.md)
- [Будущие интерфейсы](./docs/future-ui.md)

## Dev vs Prod

- **Dev (сейчас)**: код запускаем локально, зависимости (Postgres) можно поднимать в Docker по мере необходимости.
- **Prod (потом)**: собираем Docker Compose с `agent-core`, `worker`, `postgres` (и опционально n8n).