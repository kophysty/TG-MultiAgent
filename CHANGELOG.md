# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
- Updated Tasks DB reference to the new Notion database.


