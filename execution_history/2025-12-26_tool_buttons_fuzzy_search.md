# Sprint: Tool confirm buttons, fuzzy search, and safe Notion updates

Date: 2025-12-26

## Goal

Improve reliability and UX of AI tool actions:

- Use inline confirm/cancel buttons for tool actions
- Make task lookup resilient to voice transcription artifacts
- Prevent accidental category loss when renaming tasks

## Scope

- In scope:
  - Inline confirmation buttons for tool actions (mark done, deprecated, update, append description)
  - Fuzzy search for task lookup (normalize spaces, glue split digits)
  - Fix Notion update behavior so tags are not cleared on rename
  - Patch version bump
- Out of scope:
  - Any MCP integration
  - Multi-field fuzzy matching beyond title variants

## Key decisions

- Decision: Keep text "да/нет" as a fallback for confirmations
  - Rationale: Works in voice-first workflows and when inline keyboard fails.

## Changes implemented

- Tool confirmations:
  - Added inline keyboard buttons "Подтвердить" and "Отмена" for tool actions.
- Fuzzy search:
  - Multiple query variants are attempted when searching by title, including digit glue.
- Notion update safety:
  - `updateTask` no longer clears Tags when tag is not provided (undefined).

## Files changed (high signal)

- `core/dialogs/todo_bot.js`
  - Tool confirm keyboard and callback handling
  - Fuzzy search variants for `find_tasks` and action resolution
- `core/connectors/notion/tasks_repo.js`
  - `updateTask` treats undefined as "do not change" for optional fields
- `docs/current/ai.md`
  - Documented tool confirmation UX
- `apps/todo_bot/package.json`
  - Bumped version to `0.1.3`

## Validation

- Steps:
  - Start bot and request a list of tasks.
  - Ask: "пометь задачу как выполненную" and confirm via button.
  - Ask: "переименуй задачу X на Y" and confirm via button.
  - Verify the task category (Tags) is preserved after rename.
  - Ask via voice: "измени задачу в 1 2 3 4 cool" and verify it can be found if the real title is "1234 cool".
- Expected result:
  - Confirmations show buttons and work reliably.
  - Rename does not clear category.
  - Fuzzy search improves matches for voice-transcribed queries.

## Follow-ups

- Add more synonyms and normalization rules as new edge cases appear.



