# Sprint: Voice lists UX and default Done filtering

Date: 2025-12-26

## Goal

Improve UX for voice messages and make AI-driven task lists more useful by default (hide completed tasks unless requested).

## Scope

- In scope:
  - Route voice transcripts through the same planner tool path as text
  - Make voice status message end as a compact transcript preview (1 line)
  - Default task lists to exclude completed tasks (`Done`)
  - Allow showing completed tasks only on explicit user request
  - Add common RU category synonyms and a "today" list preset
- Out of scope:
  - Any MCP integration
  - Persistence for drafts or tool confirmations
  - New Notion schema changes

## Key decisions

- Decision: Keep a single status message for voice and replace it at the end with the transcript preview
  - Rationale: Less chat noise while still giving visibility into what was recognized.

- Decision: Default list output excludes completed tasks
  - Rationale: In day-to-day usage, users typically want only active tasks.

## Changes implemented

- Voice:
  - Removed separate "Распознано: ..." message
  - Final status message is edited to "Распознано: <one line...>"
  - Voice transcript uses the same planner and tool execution path as text messages
- Lists:
  - Default list output excludes `Done`
  - "completed/done" requests return only `Done`
  - "include completed" requests return all statuses
  - Added category synonyms:
    - Inbox: "инбокс", "входящие", "today"
    - Home: "домашние"
    - Work: "рабочие", "работа"
  - Added "today" preset: due date = today (by `TG_TZ`) plus Inbox

## Files changed (high signal)

- `core/dialogs/todo_bot.js`
  - Voice final status message now becomes transcript preview
  - List filtering defaults (exclude Done) with explicit overrides
  - "today" preset and RU synonyms for categories
- `core/ai/agent_planner.js`
  - Prompt rules for list behavior (default exclude Done, explicit include)
- `apps/todo_bot/package.json`
  - Bumped version to `0.1.2`
- `docs/current/voice.md`
  - Updated voice flow docs
- `docs/current/ai.md`
  - Added section about list requests and filters

## Validation

- Steps:
  - Start bot:
    - `cd apps/todo_bot`
    - `TG_BOT_MODE=tests TG_DEBUG=1 TG_AI=1 TG_AI_MODEL=gpt-4.1-mini TG_TZ=Europe/Moscow npm start`
  - Send a voice message "привет, как дела"
  - Send a voice message "покажи задачи на сегодня"
  - Send a voice message "покажи выполненные задачи"
- Expected result:
  - Status message is updated while processing and ends as "Распознано: ..."
  - "today" list returns due today plus Inbox
  - Default lists exclude `Done`
  - "completed" list shows only `Done`

## Follow-ups

- Add more synonyms for categories as they appear in real usage.
- Consider adding a dedicated "show completed" command if needed.


