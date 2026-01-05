# 2025-12-30 - Memory and preferences (Postgres + Notion sync)

## Goal

Add a persistent memory layer for user preferences:

- fast read path from Postgres (for AI context injection)
- Notion as a UI to view and edit preferences
- bidirectional sync via worker with retries

## Key decisions

- Postgres is the primary storage for fast reads and stable JSON representation.
- Notion is the editable UI. If a user changes a preference in Notion, that update wins and is applied to Postgres.
- Sync strategy:
  - Push (Postgres to Notion) is write-through via a queue with backoff retries.
  - Pull (Notion to Postgres) is periodic, using `last_edited_time` filter and a stored cursor timestamp.
- Default Notion pull frequency is 30 minutes to avoid frequent API calls.

## Implementation summary

- Added Postgres schema:
  - `preferences` for stored preferences per chat
  - `preferences_sync` for Notion mapping metadata and last seen timestamps
  - `notion_sync_queue` for write-through Notion updates with retries
- Added repositories:
  - `PreferencesRepo` (Postgres)
  - `NotionPreferencesRepo` (Notion)
- Extended reminders worker to also run memory sync:
  - processes push queue
  - pulls edited preferences from Notion
  - updates per-chat profile summary in Notion
- Planner now receives a short memory summary.

## Files changed (high signal)

- `infra/db/migrations/003_preferences.sql`
- `infra/db/migrations/004_preferences_sync.sql`
- `infra/db/migrations/005_notion_sync_queue.sql`
- `core/connectors/postgres/preferences_repo.js`
- `core/connectors/notion/preferences_repo.js`
- `apps/reminders_worker/src/main.js`
- `core/ai/agent_planner.js`
- `core/dialogs/todo_bot.js`
- `docs/current/memory.md`
- `docs/current/index.md`

## How to validate

1) Ensure env is set:

- `NOTION_PREFERENCES_DB_ID`
- `NOTION_PREFERENCE_PROFILES_DB_ID`
- `POSTGRES_URL`

2) Start worker:

- `cd apps/reminders_worker && npm start`

3) In Notion Preferences DB:

- create or edit a preference with `ChatId` set to your Telegram `chat_id`
- wait up to `TG_MEMORY_SYNC_SECONDS` (default 1800 seconds)
- send a message to the bot and confirm that planner behavior reflects the preference

4) Check that `Preference Profiles` DB gets an updated summary for your chat.

## Notes and follow ups

- Add explicit bot commands for managing memory (save, list, delete) to make the flow user-friendly.
- Consider adding a manual "pull now" command to refresh from Notion on demand.







