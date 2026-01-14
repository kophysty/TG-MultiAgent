# Execution history

This folder contains completed sprint writeups.

## Naming convention

- `YYYY-MM-DD_short_title.md`

## What goes into a sprint writeup

- Goal and scope
- Key decisions (with rationale)
- Implementation summary (high level)
- Files changed (high signal)
- How to validate (manual steps)
- Follow-ups and next sprint notes

## Template

Use: `execution_history/sprint_template.md`

## Completed sprints

- `2025-12-25_ai_mvp.md` - AI MVP inside polling todo bot (no n8n)
- `2025-12-26_categories_alias_version.md` - Categories rules + /start version + docs current/roadmap split
- `2025-12-26_voice_pipeline.md` - Voice pipeline v1 (download, ffmpeg, Whisper STT, AI draft)
- `2025-12-26_voice_lists_ux.md` - Voice status compaction + list filters (exclude Done by default)
- `2025-12-26_tool_buttons_fuzzy_search.md` - Tool confirm buttons + fuzzy search + safe updates (no tag loss)
- `2025-12-27_reminders_worker.md` - Reminders worker MVP (Tasks DB + Postgres dedup)
- `2025-12-28_ideas_social_toolkits.md` - Ideas + Social Media Planner toolkits (CRUD + archive + dedup)
- `2025-12-29_todo_bot_refactor.md` - Рефакторинг `todo_bot.js` (вынос executor, callback_query, voice и helpers в модули)
- `2025-12-30_time_ctx_due_datetime_ideas_area.md` - Контекст времени для AI, парсинг due datetime, Ideas Area options и кнопка Start
- `2025-12-30_security_sessions_revoke.md` - Security: sessions store, notify админам, revoke/unrevoke chatId
- `2025-12-30_memory_preferences.md` - Memory: preferences (Postgres) + Notion UI sync + planner injection
- `2025-12-31_tasks_delete_fuzzy_multi.md` - Tasks delete UX: RU voice to LAT title fuzzy resolve + multi-delete queue
- `2026-01-02_chat_memory.md` - Chat memory: chat_messages/chat_summaries + planner injection + worker summaries
- `2026-01-02_preference_suggestions.md` - Preference suggestions: extractor + Save/Don't save buttons + Notion sync queue
- `2026-01-02_ideas_social_resolve.md` - Ideas/Social: fuzzy resolve + ссылки на элементы списка + Project и merge тегов
- `2026-01-02_work_context_cache.md` - Work context: Notion -> Postgres cache + bot injection
- `2026-01-02_healthcheck_chat_memory_flag.md` - Healthcheck CLI + chat_memory_enabled flag
- `2026-01-02_dev_runner.md` - Dev runner: one command to run bot + worker
- `2026-01-04_prod_compose.md` - Docker Compose для prod (postgres + bot + worker)
- `2026-01-04_event_log.md` - Observability: event_log + trace_id (MVP)
- `2026-01-05_week_tasks_start_greeting.md` - Недельные списки задач: "на эту неделю" + /start приветствие без версии
- `2026-01-05_obs_trace_tests_diag.md` - Observability: trace_id trail + tests + diag bundle
- `2026-01-05_admin_cmds.md` - Admin команды: /commands, /errors, execution_history summary
- `2026-01-05_test_tasks_mode_predeploy.md` - Pre-deploy фиксы Docker + режим тестовой Tasks борды (переключатель в клавиатуре, per chat)
- `2026-01-07_evals_planner.md` - DevHarness (apps/evals) + фиксы planner (list vs find) + датасет 150
- `2026-01-11_llm_args_normalize.md` - Нормализация args tool планов для совместимости между моделями + bump версии todo bot до 0.2.0
- `2026-01-11_prefs_intents.md` - Preferences: распознавание синонимов "запиши/добавь в preferences" для надежного UX (Да/Нет)
- `2026-01-12_prefs_models_pg.md` - Preferences UX (Да/Нет) + /prefs_pg + /model + контроль модели через TG_AI_MODEL/AI_MODEL
- `2026-01-12_worker_run_force_memory_sync.md` - Admin: /worker_run для форсирования синка memory (Notion <-> Postgres) без ожидания 30 минут
- `2026-01-12_prefs_delete_tools_and_sync.md` - Preferences: удаление/отключение (Notion delete/Active=false) и /prefs_rm, чтобы не было “воскрешения” из Postgres
- `2026-01-13_notion_options_normalization.md` - Фикс валидации опций Notion (Status/Priority/Category) + расширение датасета тестов (v0.2.8)
- `2026-01-14_p0_social_platform_and_archive_idea.md` - P0: Social platform (unsupported) уточнение + идемпотентный archive idea + меньше спама от устаревших inline кликов (v0.2.9)
- `2026-01-14_predeploy_readiness.md` - Predeploy: Docker core deps + .dockerignore + admin команды healthcheck/restart (v0.2.10)
- `2026-01-15_notion_create_summaries.md` - Summary после создания записей в Notion: детальная информация о созданных задачах, идеях, постах и записях дневника (v0.2.12)
- `2026-01-15_deploy_runbook_migrations_healthcheck_dbid.md` - Deploy runbook + идемпотентные миграции + вывод хвостов Notion DB ID в healthcheck (v0.2.13)


