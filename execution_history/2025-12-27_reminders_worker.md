# Sprint: Reminders worker MVP (Tasks DB)

Date: 2025-12-27

## Goal

Add Telegram reminders based on the Notion Tasks DB, with a separate worker process and Postgres-based deduplication.

## Scope

- In scope:
  - Update Tasks DB link and default DB id
  - Postgres schema for subscriptions and sent reminders
  - Bot commands: `/reminders_on`, `/reminders_off` (and auto subscribe on `/start`)
  - Worker process `apps/reminders_worker` that sends reminders
- Out of scope:
  - Notion Calendar events ingestion
  - n8n workflows

## Key decisions

- Decision: Separate worker process
  - Rationale: Reminders should keep working independently of the bot polling loop.

- Decision: Deduplicate in Postgres
  - Rationale: Prevent duplicates across restarts and multiple worker runs.

## Reminder rules (defaults)

- Daily digest at `11:00` (`TG_REMINDERS_DAILY_AT`)
  - due date = today (date-only or date-time) plus Inbox
  - exclude Done and Deprecated
- Date-only tasks: day-before reminder at `23:00` (`TG_REMINDERS_DAY_BEFORE_AT`)
  - tasks due tomorrow with due date without time
- Timed tasks: reminder `60` minutes before (`TG_REMINDERS_BEFORE_MINUTES`)

## Files changed (high signal)

- `apps/todo_bot/src/main.js`
  - Pass Postgres pool into bot, set botMode
- `core/dialogs/todo_bot.js`
  - `/reminders_on` and `/reminders_off` commands
  - auto subscription on `/start` (when Postgres is configured)
- `apps/reminders_worker/src/main.js`
  - Poll Notion Tasks DB and send reminders
- `infra/db/migrations/001_subscriptions.sql`
- `infra/db/migrations/002_sent_reminders.sql`
- Docs:
  - `docs/current/reminders.md`

## Validation

- Steps:
  - Start Postgres via `infra/docker-compose.yml`
  - Apply migrations from `infra/db/migrations/`
  - Start todo bot and run `/start` (or `/reminders_on`) in Telegram
  - Start reminders worker
- Expected result:
  - Subscriptions stored in Postgres
  - Reminders are sent at the configured times
  - Restarts do not duplicate already sent reminders

## Follow-ups

- Add calendar events ingestion once Calendar DB mapping is confirmed.
- Add pagination for Notion queries if the DB grows beyond 100 results per query.


