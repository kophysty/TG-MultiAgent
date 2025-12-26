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


