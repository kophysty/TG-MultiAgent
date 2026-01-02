# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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


