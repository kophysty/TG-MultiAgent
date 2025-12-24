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


