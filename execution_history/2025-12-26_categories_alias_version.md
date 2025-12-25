# Sprint: Categories rules (Deprecated filtered, Today alias to Inbox) + bot version in /start

Date: 2025-12-26

## Goal

Stabilize the category logic so the bot never creates or suggests invalid categories, and make it easy to verify which build is running by showing the bot version in `/start`.

## Scope

- In scope:
  - Filter out `Deprecated` from:
    - manual `/addtask` category keyboard
    - AI category selection
    - task output in `/list` and `/today`
  - Keep `Today` as UI alias while writing/reading `Inbox` tag in Notion
  - AI chooses a category only from existing Notion `Tags` options (no new categories)
  - Text-based confirmation for AI task drafts (`да`/`подтверждаю` etc.)
  - `/start` shows `vX.Y.Z` from `apps/todo_bot/package.json`
  - Docs restructure:
    - `docs/roadmap/` - plan
    - `docs/current/` - current implemented behavior
- Out of scope:
  - New bot commands for moving tasks to `Deprecated` (can be added later)
  - Any n8n workflows

## Key decisions

- Decision: Categories are always read dynamically from Notion `Tags` options
  - Rationale: No hardcoding, categories stay in sync with the DB.

- Decision: `Today` is UI-only alias, real tag is `Inbox`
  - Rationale: Preserve familiar UX while keeping DB consistent.

## Changes implemented

- AI:
  - Prompt receives list of allowed categories (Notion `Tags` minus `Deprecated`).
  - If AI is unsure - it falls back to `Inbox`.
  - Confirmation works via buttons and via text ("да"/"подтверждаю", "нет"/"отмена").

- Manual `/addtask`:
  - `Deprecated` is not shown.
  - Selecting `Today` writes the `Inbox` tag in Notion.

- Versioning:
  - `/start` responds with the current bot version `v0.1.0` from `apps/todo_bot/package.json`.

## Files changed (high signal)

- `core/dialogs/todo_bot.js`
  - Category aliasing and filtering, AI draft confirm/cancel by text, `/start` version output.

- `core/ai/todo_intent.js`
  - Category constraints in prompt with "choose exactly one category from allowed list".

- `docs/index.md`
  - Adds separation between `roadmap` and `current`.

- `docs/current/index.md`
  - Documents current bot behavior and flags.

## Validation

- Steps:
  - Run bot with AI enabled:
    - `cd apps/todo_bot`
    - `TG_BOT_MODE=tests TG_DEBUG=1 TG_AI=1 TG_AI_MODEL=gpt-4.1-mini npm start`
  - In Telegram:
    - Send `/start` and confirm version is shown.
    - Send a task message and confirm category is always present (never "не указана"), and is from existing Notion tags.
    - Confirm via text: reply with "да" instead of pressing the button.
  - Manual flow:
    - `/addtask` - confirm `Deprecated` is not present in category keyboard.
    - Select `Today` - verify in Notion that tag is `Inbox`.

## Follow-ups

- Add an explicit bot command to move tasks to `Deprecated` safely (with confirmation).
- Add better logs/telemetry around chosen category + fallback reasons (no secrets).


