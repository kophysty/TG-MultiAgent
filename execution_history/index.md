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
- `2026-01-05_week_tasks_start_greeting.md` - Недельные списки задач: "на эту неделю" + /start приветствие без версии


