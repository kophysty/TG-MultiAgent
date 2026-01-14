# Changelog

All notable changes to this project will be documented in this file.

## [0.2.15] - 2026-01-15
### Fixed
- Voice: inline кнопка "Отмена" больше не исчезает при смене статусов распознавания. При каждом `editMessageText` переустанавливаем `reply_markup`, а на стадии анализа убираем клавиатуру.

## [0.2.14] - 2026-01-15
### Added
- Voice: inline кнопка "Отмена" на статус сообщении во время скачивания, конвертации и распознавания voice. Нажатие отменяет текущую обработку и удаляет статусное сообщение. Если отменить до STT и AI, токены не тратятся.

## [0.2.13] - 2026-01-15
### Added
- Healthcheck: в Notion секции теперь показываем хвосты DB ID (например `(...dbe7c)`), чтобы быстро сверять что env указывает на правильные базы.
- Deploy: добавлен идемпотентный скрипт миграций `infra/db/migrate.sh` (с трекингом примененных файлов) и единый сценарий `infra/deploy/prod_deploy.sh` (postgres -> wait healthy -> migrate -> up bot/worker -> healthcheck).
- Docs: добавлен prod runbook `docs/devops/deploy.md`.

## [0.2.12] - 2026-01-15
### Added
- Summary после создания записей в Notion: бот теперь показывает детальную информацию о созданных задачах, идеях, постах и записях дневника (база, категория, статус, приоритет, даты, ссылка на Notion и т.д.).

## [0.2.11] - 2026-01-14
### Added
- Технический bump версии для тестирования после predeploy изменений.

## [0.2.10] - 2026-01-14
### Added
- Admin: команды `/healthcheck` (алиас `/hc`) и `/healthcheck_json` прямо из Telegram (Postgres + Notion).
- Admin: команды `/restart_polling` и `/restart_process confirm` для управления ботом без доступа к серверу.

### Fixed
- Docker prod: в образах bot и worker теперь устанавливаются зависимости `core` (иначе падало на `require('pg')`).
- Docker build: добавлен `.dockerignore`, чтобы сборка не тащила `node_modules` и `data`.

## [0.2.9] - 2026-01-14
### Fixed
- Social: если указана неподдерживаемая платформа, бот просит выбрать из доступных (вместо "Не понял платформу") и не спамит ошибками при быстрых кликах.
- Inline UX: устаревшие inline-клики больше не отправляют в чат сообщения "Выбор устарел. Попробуй еще раз." (используем toast через callback query).
- Ideas: повторное архивирование одной и той же идеи больше не падает с `HTTP 400 validation_error` и отвечает "Похоже, эта идея уже в архиве."

### Added (Evals)
- Точечные датасеты для проверки P0 кейсов:
  - `apps/evals/ds/14_2026-01-14_p0_social_focus.jsonl`
  - `apps/evals/ds/15_2026-01-14_p0_ideas_archive_focus.jsonl`

## [0.2.8] - 2026-01-13
### Fixed
- Валидация статусов и полей (select/status/multi_select) в Notion. Теперь бот нормализует или отбрасывает некорректные значения, чтобы избежать `HTTP 400 validation_error`.
- Удалены жестко заданные дефолтные статусы (`Idle`, `Inbox`, `Post Idea`) в репозиториях Notion, чтобы Notion мог использовать дефолты из настроек базы данных.

### Added (Evals)
- Генераторы разнообразных датасетов для E2E тестирования:
  - `gen_ds_06_diverse_core.js` -> 300 разнообразных core кейсов (tasks, ideas, social, journal, memory)
  - `gen_ds_07_diverse_adversarial.js` -> 150 adversarial кейсов (невалидные данные, XSS, prompt injection)
  - `gen_ds_08_stt_errors.js` -> 100 кейсов с типичными ошибками STT (склейки, опечатки, слова-паразиты)
  - `gen_ds_09_memory_prefs.js` -> 80 кейсов для memory/preferences (save, delete, sync)
  - `gen_ds_10_commands.js` -> 40 кейсов для реальных /commands бота
  - `gen_ds_11_context.js` -> 50 контекстно-зависимых кейсов (chatHistory, workContext, memorySummary)
  - `gen_ds_12_addon_create.js` -> 200 create-heavy кейсов для нагрузочного тестирования
- Обновлен план E2E тестирования `.cursor/plans/13_*.plan.md` с новой структурой датасетов (920 кейсов total)

## Unreleased

- Admin UI:
  - В админской клавиатуре кнопка сокращена до `/cmnds` (алиас: `/commands`), чтобы помещалось на телефоне.

- Reminders:
  - Утренний дайджест включает "Посты сегодня" из Social Media Planner (исключая `Published` и `Cancelled`).
  - Добавлены напоминания за `TG_REMINDERS_BEFORE_MINUTES` минут до `Post date` для постов (исключая `Published` и `Cancelled`).
  - Добавлены подробные `TG_DEBUG=1` логи (tick snapshot, memory sync stats, /worker_run, отправки напоминаний).
  - Fix: удаление/архивация preferences в Notion больше не “воскрешается” из Postgres (reconcile archived/missing по `preferences_sync.notion_page_id`).
  - Bumped reminders worker version to `v0.1.10`.

- Telegram polling:
  - При `409 Conflict` (другая инстанция бота делает getUpdates) отправляем предупреждение в админ-чат и останавливаем polling в текущем процессе.

- Voice:
  - Улучшена диагностика ошибок voice (stage, HTTP status) и добавлен fallback моделей STT при проблемах доступа к `whisper-1`.

- Chat memory UX (admin):
  - Добавлены команды `/chat_history` и `/chat_find` для просмотра/поиска по `chat_messages` в Postgres.
  - Planner теперь получает timestamps в `chatHistory`, чтобы корректнее отвечать на вопросы вида "что было в HH:MM".
  - Bumped todo bot version to `v0.2.7`.

- Preferences UX and diagnostics:
  - Подтверждение сохранения preference: короткий вопрос и кнопки Да/Нет.
  - Явные команды "запомни/добавь в память" теперь сохраняют "сырой факт" как заметку (category `memory_note`) даже если extractor не выделил структурированные preferences.
  - Добавлены админ-команды `/prefs_pg` и `/model` для детерминированной диагностики (Postgres и модели).
  - Добавлена админ-команда `/worker_run` для принудительного запуска синка memory (Notion <-> Postgres) в reminders worker без ожидания `TG_MEMORY_SYNC_SECONDS`.
  - Явное управление моделью через `TG_AI_MODEL` (и алиас `AI_MODEL`).
  - Расширен детектор "это preference" на команды вида "запиши/зафиксируй/добавь в preferences", чтобы не было ложных ответов "сохранил" без кнопок.
  - При OpenAI 429 (rate limit) бот теперь отвечает пользователю, а не молчит.
  - При TG_AI=0 бот теперь не молчит в админ-чате на обычные текстовые сообщения: пишет подсказку как включить AI и как проверить /model.
  - `/model` теперь также показывает TG_AI и наличие OPENAI_API_KEY (set or missing).
  - Добавлена админ-команда `/prefs_rm <номер|key>` для выключения preference (active=false) и отправки этого изменения в Notion.

- Tasks fuzzy resolve:
  - Улучшен fuzzy-match для voice случаев, когда слова “склеены” (например `testworktask`), чтобы не показывать нерелевантный длинный список кандидатов.

- Dev: evals (DevHarness для planner):
  - Добавлен пакет `apps/evals` - CLI для dataset прогонов planner и отчета mismatch (json).
  - Добавлены ожидания `argsAnyOf`, regex matcher и мягкая нормализация (падежи, регистр, ISO даты) в сравнении.
  - Добавлены throttle и retry/backoff для 429 и transient сетевых ошибок (для больших прогонов).
  - Добавлены sample dataset и генератор датасета на 150 кейсов.

- Planner: list vs find:
  - Запросы вида "покажи задачи про X" и "список задач по слову X" должны идти в `notion.list_tasks` с `args.queryText`, а не в `notion.find_tasks`.

- Voice UX:
  - Улучшен “status” в чате во время обработки voice (скачивание → ffmpeg → STT → анализ → выполнение) с короткими шагами и эмоджи.

- Todo bot admin (security) команды и диагностика:
  - Admin-only `/commands` (список админских команд).
  - `/errors [hours]` - последние ошибки (Postgres `event_log`) по текущему чату.
  - `/history_list N`, `/history_show N|file`, `/history_summary days` - просмотр `execution_history/` из чата.
  - Startup resiliency: ретраи на старте при transient Notion ошибках и best-effort notify админам.
  - Bumped todo bot version to `v0.1.38`.

- Agent safety:
  - Добавлено правило: никогда не делать откаты (rollback/revert/reset/cherry-pick/force-push и т.п.) без явного согласования пользователя.

- Memory and preferences (MVP):
  - Added Postgres tables for user preferences and a Notion sync queue.
  - Added Notion Preferences DB + Profiles DB support.
  - Reminders worker now syncs memory both ways (Notion edits win) and pushes profile summaries.
  - Planner receives a short memory summary in context.

- Chat memory (Postgres):
  - Added `chat_messages` and `chat_summaries` tables (persistent dialog memory).
  - Todo bot stores incoming user text and outgoing assistant messages (best-effort) when Postgres is enabled.
  - Reminders worker periodically builds a short chat summary via LLM and purges old chat messages by TTL.
  - Planner context now includes chat summary and recent chat messages (in addition to preferences).
  - Bumped todo bot version to `v0.1.23` and reminders worker to `v0.1.1`.

- Preference suggestions:
  - Added `memory_suggestions` table for preference candidates (Save / Don't save UX).
  - Added LLM preference extractor and inline buttons to save preferences to Postgres and enqueue Notion sync.
  - Preference suggestions work for voice transcripts too (after STT).
  - Fixed Notion sync so `pref_page_upsert` works when only Preferences DB is configured (Profiles DB is optional).
  - Bumped todo bot version to `v0.1.26` and reminders worker to `v0.1.2`.

- Work context cache:
  - Added `work_context_cache` table (Postgres).
  - Reminders worker periodically fetches compact context from Notion (Tasks, Ideas, Social) and stores it per chat_id.
  - Todo bot injects work context into planner when `TG_WORK_CONTEXT_MODE=auto|always` and cache is fresh.
  - Bumped todo bot version to `v0.1.27` and reminders worker to `v0.1.3`.

- Healthcheck and per-chat chat memory flag:
  - Added `chat_memory_enabled` preference to disable chat memory for a specific chat_id (default enabled).
  - Added CLI healthcheck script for Postgres, Notion, and Telegram send.
  - Bumped todo bot version to `v0.1.28` and reminders worker to `v0.1.4`.

- Social Media Planner (schedule lists):
  - List posts understands date phrases: tomorrow/day after tomorrow, "on Nth day", and "this week" (from today until next Monday, in `TG_TZ`).
  - For schedule-style queries, hides posts without `Post date` and excludes `Published` and `Cancelled` by default.
  - Bumped todo bot version to `v0.1.29`.

- Tasks (week ranges):
  - List tasks understands "this week" and "next week" ranges based on `TG_TZ`, including phrasing like "на эту неделю".
  - Week lists include tasks with Due Date in the range plus Inbox (even without due date). Other tasks without due date are excluded.
  - Prevented AI pipeline from responding to `Start` (avoids duplicate greetings).
  - `/start` greeting no longer repeats version (version is sent as a separate message).
  - Bumped todo bot version to `v0.1.32`.

- Dev orchestration:
  - Added `core/runtime/dev_runner.js` to run todo bot and reminders worker from one command.

- Prod Docker Compose:
  - Added `infra/docker-compose.prod.yml` (postgres + todo bot + reminders worker) with healthchecks, restart policy, and log rotation.
  - Added Dockerfiles under `apps/todo_bot/` and `apps/reminders_worker/` to build production containers.

- Observability (event_log):
  - Added `event_log` table (Postgres) and repo for inserting/querying/purging sanitized events.
  - Added trace_id propagation via AsyncLocalStorage and extended decision trail:
    - executor tool calls
    - Notion request/response/error
    - Telegram send (outbound)
  - Added diag bundle CLI under `apps/diag` (writes to `data/diag/`, ignored by git).
  - Healthcheck CLI now supports `--json`.
  - Added `core` unit tests (node:test) for helpers.
  - Bumped todo bot version to `v0.1.36` and reminders worker to `v0.1.6`.

- Tasks test board mode:
  - Added per-chat toggle via reply keyboard: `Тест задачи: ВКЛ` and `Тест задачи: ВЫКЛ`.
  - When enabled, all Tasks operations (AI and commands like /today and /list) use `NOTION_TASKS_TEST_DB_ID`.
  - Bot marks outputs with `[TEST TASKS]` prefix to avoid mixing with main tasks.

- Docker pre-deploy fixes:
  - Added ffmpeg to production images (required for voice pipeline).
  - Fixed prod compose healthcheck paths to use absolute `/app/core/runtime/healthcheck.js`.

- Ideas tags semantics:
  - Update Idea tags are merged by default (adds to existing tags) unless user explicitly asks to replace tags.
  - Fixed RU trigger so "добавь тег" is detected correctly.
  - Added executor unit tests for tags merge/replace, last-shown resolve, schedule filters, and multi-delete queue fallback.

- Ideas and Social resolve:
  - Added fuzzy-resolve for Ideas and Social (RU voice -> LAT titles, local fallback).
  - Added last shown list references like "in the first idea" / "в первой идее" for update/archive flows.
  - Idea update supports "add tag" semantics (merge) and `Project` field.
  - Default AI model for todo bot is now `gpt-4.1` when `TG_AI_MODEL` is not set.
  - Bumped todo bot version to `v0.1.25`.

- Tasks delete UX (AI + voice):
  - Task resolve now matches RU voice to LAT titles (translit + local fuzzy fallback).
  - Multi-delete from one message is supported via confirm queue.
  - Deprecated confirm always shows task title and keeps queue between steps.

- Initial repository bootstrap (git, ignore rules, baseline docs).
- Added `docs/` with structured documentation exported from Notion "Base structure".
- Updated `README.md` to point to Notion as the single source of truth and to `docs/index.md`.
- Added links to Telegram bots and a Notion DB for CRUD testing.
- Added `infra/docker-compose.yml` to run local Postgres and n8n.
- Added Node.js polling todo bot under `apps/todo_bot/` based on legacy `TG-Notion-todo-bot` flow (inline menus, Notion Tasks CRUD).
- Added `execution_history/` for completed sprint writeups (with index and template).
- Started tracking `.cursor/rules/` in git while ignoring the rest of `.cursor/` (except `.cursor/commons/` and `.cursor/plans/`).
- Added OpenAI-powered AI MVP behind `TG_AI=1` to classify question vs task, summarize a parsed task, and create it in Notion on confirmation.
- Updated env loader to parse standard `.env` `KEY=VALUE` entries (e.g. `OPENAI_API_KEY`) from repo root.
- Constrained AI to use only existing Notion `Tags` categories (excluding `Deprecated`) and added `Today` (UI) alias to `Inbox` (Notion tag).
- Added bot version output to `/start` and reorganized docs into `docs/roadmap/` and `docs/current/`.
- Added voice pipeline v1: download Telegram voice, convert via ffmpeg, transcribe with OpenAI Whisper, then run existing AI flow and confirmation.
- Removed PMD step from manual add flow and made Notion task creation resilient to removed DB properties.
- Improved AI Notion lists:
  - Default lists exclude completed tasks (`Done`).
  - Completed tasks are shown only by explicit request.
  - Added category synonyms and "today" preset (due today plus Inbox).
- Improved voice UX:
  - Voice transcript is routed through the same planner tool path as text.
  - Final status message is replaced with a 1-line transcript preview ("Распознано: ...").
- Fixed Notion update behavior:
  - Renaming/updating a task no longer clears its Tags/category when tag is not provided.
- Improved tool UX:
  - Tool confirmations now use inline buttons (with "да/нет" fallback).
- Improved fuzzy search:
  - Task lookup tolerates voice artifacts (extra spaces, digit splitting like "1 2 3 4").
- Reminders worker (MVP):
  - Added Postgres-backed subscriptions and deduplicated reminders log.
  - Added `/reminders_on` and `/reminders_off` commands (requires `POSTGRES_URL`).
  - Added `apps/reminders_worker` to send reminders (daily digest at 11:00, day-before 23:00 for date-only, 60 min before for timed tasks).
  - Daily 11:00 summary includes tasks with due time (not only date-only) and prints a separate Inbox section.
- Updated Tasks DB reference to the new Notion database.
- Added Ideas DB and Social Media Planner toolkits (list/create/update/archive) and a platform picker for social post creation.
- Added duplicate check for create actions (tasks, ideas, social posts) with confirmation.
- Improved Social Media Planner robustness:
  - Normalize platform/status/content type inputs (RU/EN synonyms + best-effort match to Notion options).
  - Ask to pick platform via inline buttons if it cannot be matched.
- Social post date inference:
  - If user says "сегодня/завтра/послезавтра" the bot auto-fills `Post date` when creating a post.
- Ideas category safety:
  - Category is matched to existing Notion options to avoid accidentally creating new categories.
- Fixed `/today`, `/list`, and `/struct` commands (Tasks repo reference).
- Improved Notion error reporting in `TG_DEBUG=1` (shows a short reason).
- Bumped todo bot version to `v0.1.7`.
- Refactored `core/dialogs/todo_bot.js` by extracting large blocks into modules (`todo_bot_helpers`, `todo_bot_executor`, `todo_bot_callbacks`, `todo_bot_voice`) without changing bot behavior.

- Time and timezone robustness:
  - The agent planner now receives current time context and `TG_TZ` to interpret relative dates correctly.
  - Task creation parses "today/tomorrow/day after tomorrow + time" from user text into ISO datetime with timezone offset to avoid UTC shifts.
- Ideas DB improvements:
  - Added `Area` auto-fill from context, matching existing options.
  - If `Area` is `select` or `multi_select` and no option matches, the bot can create a new option (without duplicates) and set it.
- Bot UX:
  - Reply keyboard now uses `Start` button (works the same as `/start`) instead of showing `/struct` by default.
- Security logs hotfix:
  - Debug logs sanitize Telegram bot token in URLs and error messages.
  - Added global handlers for `unhandledRejection` and `uncaughtException` that log sanitized errors only.
- Security (sessions, notify, revoke):
  - Added sessions store with Postgres backend and file fallback.
  - Admin notifications on first contact from a new chatId.
  - Admin commands: `/sessions`, `/security_status`, `/revoke`, `/revoke_here`, `/unrevoke`.
  - Revoked chats are blocked for messages and callback queries.
- Bumped todo bot version to `v0.1.16`.


