# History

## 2025-12-24

- Initialized project documentation based on Notion "Base structure".
- Added `.gitignore` to prevent committing secrets like `.env`.
- Prepared repository to be linked with GitHub remote.
- Added `docs/` with a structured set of markdown files derived from Notion "Base structure".
- Updated `README.md` with a Notion source-of-truth link and docs entrypoint.

## 2025-12-25

- Added `execution_history/` folder for completed sprint writeups (index + template).
- Added repo links to `execution_history/` from `README.md` and `docs/index.md`.
- Started tracking `.cursor/rules/` in git and ignored the rest of `.cursor/` (keeping `.cursor/commons/` and `.cursor/plans/` allowed).
- Added link to the Notion database used for Tasks CRUD testing.
- Added local Compose scaffold for Postgres and n8n under `infra/`.
- Added Node.js polling todo bot scaffold under `apps/todo_bot/` (inline menus + Notion CRUD) based on legacy `TG-Notion-todo-bot`.
- Added OpenAI integration (AI MVP) behind `TG_AI=1`: classify message as question vs task, summarize parsed task, confirm/cancel, and create task in Notion.
- Updated env loader to parse `.env` `KEY=VALUE` from repo root so `OPENAI_API_KEY` works when launching from `apps/todo_bot/`.

## 2025-12-26

- Added `/start` bot version output (vX.Y.Z from `apps/todo_bot/package.json`).
- Enforced category rules:
  - `Deprecated` is excluded from bot menus and outputs.
  - `Today` is a UI alias for Notion tag `Inbox`.
  - AI is constrained to choose a category only from Notion `Tags` options (fallback to `Inbox`).
- Reorganized docs into `docs/roadmap/` (plan) and `docs/current/` (current implemented behavior).
- Added voice pipeline v1: download voice by `file_id`, convert via ffmpeg to wav 16k mono, transcribe with OpenAI Whisper, then run existing AI flow and confirmation.
- Removed PMD step from manual add flow and made Notion task creation dynamic to DB schema changes.
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
- Added reminders worker MVP:
  - Postgres-backed subscriptions and deduplicated sent reminders log.
  - `/reminders_on` and `/reminders_off` commands.
  - Separate `apps/reminders_worker` process for sending reminders.
  - Daily 11:00 summary includes tasks with due time and prints a separate Inbox section.
- Updated Tasks DB reference to the new Notion database.
- Added Ideas DB and Social Media Planner toolkits (list/create/update/archive) and a platform picker for social post creation.
- Added duplicate check for create actions (tasks, ideas, social posts) with confirmation.

## 2025-12-29

- Improved Social Media Planner UX:
  - Platform/status/content type inputs are normalized (RU/EN synonyms and fuzzy match to Notion options).
  - If platform cannot be matched, the bot asks to choose it via inline buttons.
- Social post dates:
  - If the user says "today/tomorrow/day after tomorrow" (RU: "сегодня/завтра/послезавтра") the bot infers `Post date` automatically when creating a post.
- Ideas categories:
  - The bot matches `Category` against existing Notion options and avoids creating new category options by mistake.
- Improved Notion error handling:
  - In `TG_DEBUG=1` the bot shows a short Notion error reason to speed up debugging.
- Bumped todo bot version to `v0.1.6`.
- Fixed `/today`, `/list`, and `/struct` commands (Tasks repo reference).
- Bumped todo bot version to `v0.1.7`.

## 2025-12-30

- Time and timezone:
  - Agent planner receives current time context and `TG_TZ`.
  - Task creation parses relative due datetime from user text (e.g. "сегодня в 15:00") into ISO with timezone offset to avoid UTC shifts.
- Ideas DB:
  - Added `Area` inference and matching to existing options.
  - If `Area` is `select` or `multi_select` and no option matches, the bot can create a new option (without duplicates) and set it.
- Bot UI:
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

- Memory and preferences:
  - Added Preferences module (Postgres schema + Notion UI sync).
  - Reminders worker syncs preferences both ways (Notion edits win) and updates a per-chat profile summary.
  - Planner context now includes a short memory summary for the current chat.
  - Bumped todo bot version to `v0.1.17`.

## 2025-12-31

- Tasks delete UX (AI + voice):
  - Улучшен резолв задач по названию: RU voice -> LAT title (translit + local fuzzy fallback).
  - Удаление нескольких задач из одного сообщения работает цепочкой подтверждений.
  - Подтверждение Deprecated всегда показывает название задачи и корректно продолжает очередь.
  - Bumped todo bot version to `v0.1.22`.

## 2026-01-02

- Chat memory:
  - Добавлены таблицы `chat_messages` и `chat_summaries` (Postgres).
  - Бот сохраняет входящие user сообщения и исходящие assistant сообщения (best-effort).
  - Planner получает chat summary и последние сообщения как дополнительный контекст.
  - Worker пересчитывает сводку чата через LLM и чистит `chat_messages` по TTL.
  - Bumped todo bot version to `v0.1.23`.
  - Bumped reminders worker version to `v0.1.1`.

- Preference suggestions:
  - Добавлена таблица `memory_suggestions` (Postgres).
  - Добавлен LLM extractor, который предлагает сохранить preference кнопками (Сохранить/Не сохранять).
  - При сохранении: upsert в Postgres preferences + enqueue `pref_page_upsert` в `notion_sync_queue`.
  - Preference suggestions работают и для voice (после STT).
  - Fix: синк в Notion для `pref_page_upsert` работает, даже если настроена только Preferences DB (Profiles DB опциональна).
  - Bumped todo bot version to `v0.1.26`.
  - Bumped reminders worker version to `v0.1.2`.

## 2026-01-14

- Social platform UX:
  - Если указана неподдерживаемая платформа (например "инстаграм"), бот просит выбрать из доступных платформ, вместо формулировки "Не понял платформу".
  - Устаревшие inline клики больше не спамят чат сообщением "Выбор устарел" (toast через callback query).
- Ideas archive:
  - Повторное архивирование уже архивированной идеи обрабатывается идемпотентно: бот отвечает что идея уже в архиве.
- Bumped todo bot version to `v0.2.9`.

- Work context cache:
  - Добавлена таблица `work_context_cache` (Postgres).
  - Worker периодически собирает компактный контекст из Notion (Tasks, Ideas, Social) и сохраняет per chat_id.
  - Todo bot подмешивает work context в planner при `TG_WORK_CONTEXT_MODE=auto|always` и свежем кэше.
  - Bumped todo bot version to `v0.1.27`.
  - Bumped reminders worker version to `v0.1.3`.

- Healthcheck и chat_memory_enabled:
  - Добавлен preference `chat_memory_enabled` для отключения chat memory per chat_id (по умолчанию включено).
  - Добавлен CLI healthcheck (Postgres, Notion, Telegram send best-effort).
  - Bumped todo bot version to `v0.1.28`.
  - Bumped reminders worker version to `v0.1.4`.

- Social Media Planner (к публикации):
  - Запросы списков постов понимают "на завтра/послезавтра", "на число" и "на этой неделе" (до следующего понедельника, в `TG_TZ`).
  - Для schedule запросов скрываются посты без `Post date` и по умолчанию исключаются статусы `Published` и `Cancelled`.
  - Bumped todo bot version to `v0.1.29`.

- Задачи (недели):
  - Списки задач понимают "на этой неделе", "на эту неделю" и "на следующей неделе" как диапазон дат, рассчитанный от текущей даты в `TG_TZ`.
  - В недельные списки попадают задачи с `Due Date` в диапазоне плюс `Inbox` (даже без due date), но не другие задачи без даты.
  - `Start` больше не уходит в AI pipeline, чтобы не было дубля приветствия.
  - `/start` приветствие больше не дублирует версию (версия приходит отдельным сообщением).
  - Bumped todo bot version to `v0.1.32`.

- Dev оркестрация:
  - Добавлен `core/runtime/dev_runner.js` для запуска bot и worker одной командой.

- Prod Docker Compose:
  - Добавлен `infra/docker-compose.prod.yml` (postgres + bot + worker) с healthcheck, restart policy и ротацией логов.
  - Добавлены Dockerfile для сборки контейнеров: `apps/todo_bot/Dockerfile`, `apps/reminders_worker/Dockerfile`.

- Observability (event_log):
  - Добавлена таблица `event_log` (Postgres) и repo для записи/query/purge событий (payload только sanitized).
  - Добавлен `trace_id` через AsyncLocalStorage и расширен decision trail:
    - tool calls executor
    - Notion request/response/error
    - Telegram send (outbound)
  - Добавлен CLI `apps/diag` для сборки диагностического bundle (пишет в `data/diag/`, папка в .gitignore).
  - Healthcheck CLI поддерживает `--json`.
  - Добавлены unit tests в `core` (node:test) для helpers.
  - Bumped todo bot version to `v0.1.34`.
  - Bumped reminders worker version to `v0.1.6`.

- Ideas/Social resolve UX:
  - Добавлен продвинутый fuzzy-resolve для Ideas и Social (RU voice -> LAT title, local fallback).
  - Можно ссылаться на элементы из последнего списка фразами типа "в первой идее" или "во втором посте".
  - Update Idea теперь поддерживает merge тегов ("добавь тег") и заполнение поля `Project`.
  - Дефолтная модель для AI в todo bot теперь `gpt-4.1` (если `TG_AI_MODEL` не задан).
  - Bumped todo bot version to `v0.1.25`.

## 2026-01-05

- Todo bot admin (security) команды и диагностика:
  - Admin-only `/commands` (список админских команд).
  - `/errors [hours]` - последние ошибки (Postgres `event_log`) по текущему чату.
  - `/history_list N`, `/history_show N|file`, `/history_summary days` - просмотр `execution_history/` из чата.
  - Startup resiliency: ретраи на старте при transient Notion ошибках и best-effort notify админам.
- Ideas tags semantics:
  - "поставь теги X" добавляет теги к существующим (merge) по умолчанию.
  - "замени теги" перезаписывает теги.
  - Fix: "добавь тег" корректно детектится как merge.
- Tests:
  - Добавлены unit tests для executor (tags merge/replace, last-shown resolve, schedule фильтры, multi-delete queue fallback).
- Tasks test board mode:
  - Добавлен per chat переключатель в клавиатуре: "Тест задачи: ВКЛ" и "Тест задачи: ВЫКЛ".
  - В режиме ВКЛ все операции с задачами (AI и команды /today, /list, /addtask) работают с `NOTION_TASKS_TEST_DB_ID`.
  - Ответы и списки помечаются префиксом `[TEST TASKS]`.
- Docker pre-deploy fixes:
  - В Docker образы добавлен ffmpeg (нужен для voice пайплайна).
  - В prod compose починены пути healthcheck (абсолютный путь до core/runtime/healthcheck.js).
- Bumped todo bot version to `v0.1.38`.

## 2026-01-06

- Agent safety:
  - Добавлено правило: никогда не делать откаты (rollback/revert/reset/cherry-pick/force-push и т.п.) без явного согласования пользователя.

- Voice UX:
  - Улучшен “status” в чате во время обработки voice (скачивание → ffmpeg → STT → анализ → выполнение) с короткими шагами и эмоджи.

- Chat memory UX (admin):
  - Добавлены команды `/chat_history` и `/chat_find` для просмотра/поиска по `chat_messages` в Postgres.
  - Planner теперь получает timestamps в `chatHistory`, чтобы корректнее отвечать на вопросы вида "что было в HH:MM".
  - Bumped todo bot version to `v0.1.42`.

- Tasks fuzzy resolve:
  - Улучшен fuzzy-match для voice случаев, когда слова “склеены” (например `testworktask`), чтобы не показывать нерелевантный длинный список кандидатов.

## 2026-01-07

- Dev: evals (DevHarness для planner):
  - Добавлен пакет `apps/evals` - CLI для dataset прогонов planner и отчета mismatch.
  - Добавлены retry/backoff и throttle для стабильных больших прогонов (защита от 429).
  - Подготовлен датасет на 150 кейсов (утро и около 12:00) для проверки поведения.

- Planner: list vs find:
  - Запросы вида "покажи задачи про X" и "список задач по слову X" теперь должны выбирать `notion.list_tasks` с `args.queryText` (вместо `notion.find_tasks`).

## 2026-01-11

- Admin UI:
  - В админской клавиатуре кнопка сокращена до `/cmnds` (алиас: `/commands`), чтобы помещалось на телефоне.
  - Bumped todo bot version to `v0.2.2`.

- Today semantics:
  - В выводе "на сегодня" (`/today` и AI preset today) `Inbox` задачи с due date в будущем больше не показываются.

- Telegram polling:
  - При `409 Conflict` (другая инстанция бота делает getUpdates) отправляем предупреждение в админ-чат и останавливаем polling в текущем процессе.

- Voice:
  - Улучшена диагностика ошибок voice (stage, HTTP status) и добавлен fallback моделей STT при проблемах доступа к `whisper-1`.

- Preferences UX and diagnostics:
  - Подтверждение сохранения preference: короткий вопрос и кнопки Да/Нет.
  - Добавлены админ-команды `/prefs_pg` и `/model` для детерминированной диагностики (Postgres и модели).
  - Явное управление моделью через `TG_AI_MODEL` (и алиас `AI_MODEL`).
  - Расширен детектор "это preference" на команды вида "запиши/зафиксируй/добавь в preferences", чтобы синонимы корректно запускали подтверждение.

- Reminders:
  - Утренний дайджест включает "Посты сегодня" из Social Media Planner (исключая `Published` и `Cancelled`).
  - Добавлены напоминания за `TG_REMINDERS_BEFORE_MINUTES` минут до `Post date` для постов (исключая `Published` и `Cancelled`).
  - Bumped reminders worker version to `v0.1.7`.

## 2026-01-13

- **Validation Fix**: Исправлена ошибка `validation_error` в Notion при попытке отправить несуществующий статус или опцию. Добавлена нормализация полей `Status`, `Priority`, `Category`, `Area`, `Platform` и `Content type` во всех инструментах Notion.
- **Dataset Expansion**: Датасет тестов `apps/evals/ds/03_2026-01-13_full_features.jsonl` расширен кейсами с "невалидными" данными для проверки устойчивости бота.
- **Notion Repositories**: Удалены хардкод-дефолты для статусов, позволяя Notion использовать настройки базы по умолчанию.
- Bumped todo bot version to `v0.2.8`.
- **Evals Datasets (comprehensive E2E testing)**:
  - Новый генератор `gen_ds_06_diverse_core.js` -> 300 разнообразных core кейсов
  - Новый генератор `gen_ds_07_diverse_adversarial.js` -> 150 adversarial кейсов (XSS, prompt injection, невалидные данные)
  - Новый генератор `gen_ds_08_stt_errors.js` -> 100 кейсов STT ошибок (склейки, опечатки, слова-паразиты)
  - Новый генератор `gen_ds_09_memory_prefs.js` -> 80 кейсов memory/preferences
  - Новый генератор `gen_ds_10_commands.js` -> 40 кейсов реальных /commands бота
  - Новый генератор `gen_ds_11_context.js` -> 50 контекстно-зависимых кейсов
  - Новый генератор `gen_ds_12_addon_create.js` -> 200 create-heavy кейсов
  - Обновлен план E2E `.cursor/plans/13_*.plan.md`: Mode B, trash cleanup, full reporting, 920 кейсов total

## 2026-01-12

- Preferences and memory notes:
  - Явные команды "запомни/в память" сохраняют "сырой факт" как заметку (category `memory_note`) через подтверждение Да/Нет, даже если extractor не смог выделить структурированное preference.
  - Добавлена админ-команда `/worker_run` для принудительного запуска синка memory (Notion <-> Postgres) в reminders worker (без ожидания 30 минут).
  - Исправлено: при OpenAI 429 (rate limit) бот отвечает пользователю, а не молчит.
  - Исправлено: при TG_AI=0 бот не молчит в админ-чате на обычный текст и пишет подсказку как включить AI.
  - Добавлены подробные `TG_DEBUG=1` логи в reminders worker (tick snapshot, memory sync stats, /worker_run, отправки напоминаний).
  - `/model` теперь также показывает TG_AI и наличие OPENAI_API_KEY.
  - Fix: удаление/архивация preferences в Notion больше не “воскрешается” из Postgres.
  - Добавлена команда `/prefs_rm` для удаления/отключения preferences из памяти.
  - Bumped todo bot version to `v0.2.7`.
  - Bumped reminders worker version to `v0.1.10`.


