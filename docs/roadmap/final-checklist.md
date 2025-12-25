# Финальный сборочный лист

## A) Инфраструктура

1. VPS + Docker Compose
2. Контейнеры:
   - `agent-core` (API + Telegram bot + оркестратор + MCP-клиент)
   - `worker` (фоновые задачи: STT, индексация, sync, сводки и напоминания)
   - `postgres` (единственная БД сервиса)
3. Внутри образа `agent-core` и `worker` поставить ffmpeg (для конвертации Telegram voice)

## B) Notion (первоисточник данных)

1. Notion базы:
   - **Tasks** (задачи)
   - **Ideas** (идеи)
   - **Documents** (карточки документов: метаданные + ссылка, вложение или страница)
2. Подключение к Notion через официальный Notion MCP:
   - сначала hosted MCP `mcp.notion.com` (если подходит по стеку и доступу)
   - иначе self-host `makenotion/notion-mcp-server`
3. Правило:
   - делаем power-first personal версию: Postgres + быстрый индекс + agent memory
   - Notion оставляем как источник и витрину, но агент отвечает из Postgres-индекса
   - если поступила задача (добавление, удаление, обновление), то агент работает напрямую с Notion
   - минимальную абстракцию хранилища закладываем без SaaS-сложностей, чтобы не прилипнуть к Notion намертво

## C) Postgres (операционная память + индекс)

1. В Postgres храним не дубль Notion, а:
   - agent state: черновики, FSM диалогов, дедуп апдейтов Telegram
   - jobs/queue + логи выполнения
   - memory/preferences: предпочтения и контекст (дефолтные разделы, правила triage, таймзона, привычки)
   - documents index: текстовые чанки + FTS + опционально `pgvector` для семантики

## D) AI-оркестрация (агент)

1. В `agent-core` добавить 4 блока:
   - Intent Router: задача, вопрос, апдейт, удаление, идея, документы, настройки
   - Planner: план tool-calls в строгом JSON
   - Executor: выполняет инструменты, ретраи и таймауты, логирует
   - Guards/Policies: подтверждения для delete, low-confidence -> уточнения, таймаут -> Inbox
2. Tool Registry (единый список инструментов), минимум:
   - `telegram.update_status`, `telegram.ask_clarify`
   - `stt.transcribe` (после ffmpeg-конвертации)
   - `notion.tasks.create/update/delete/query` (через MCP)
   - `notion.ideas.create`
   - `docs.ingest/search/quote`
   - `memory.save/get`

## E) Голосовой ввод (через Telegram)

1. Пайплайн voice:
   - скачать voice по `file_id` -> ffmpeg в wav 16k mono -> `stt.transcribe`
   - router -> planner -> создать задачу или задать уточнения
2. UX-статусы в чате:
   - "скачиваю" -> "конвертирую" -> "расшифровываю" -> "формирую задачу" -> "пишу в Notion" -> "готово"
   - реализуем через редактирование одного сообщения (edit)

## F) Расписания без n8n

1. Встроенный scheduler (в worker):
   - утренняя сводка (Europe/Amsterdam)
   - напоминания (due/repeat + антиспам-лог)
   - draft timeout (молчание -> Inbox "needs triage")
   - sync Notion -> кэш или индекс (если нужно, по `last_edited_time`)

## G) Документы и выдержки

1. Документы:
   - храним в Notion как библиотеку (страница или файл + метаданные)
   - на VPS делаем ingest: вытаскиваем текст -> режем на чанки -> сохраняем в Postgres
2. Ответы по документам:
   - поиск (FTS + опционально векторы) -> выдача выдержек + ссылки на источник

## H) Будущие интерфейсы

Любой будущий UI (веб, Chrome extension, приложение) ходит в твой agent API, а не в Notion напрямую.


