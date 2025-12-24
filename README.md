# TG-MultiAgent

Telegram multi-agent assistant with a clean separation between core logic, orchestration and integrations.

## Core ideas

- **Docker first**: one VPS, minimal magic, portable deploys, easy to add system deps (ffmpeg) and Postgres if needed.
- **N8N is wiring, not brain**: orchestration for triggers and connectors, but state and business logic live in code.
- **Agent loop**: LLM produces a structured plan, code executes deterministically with retries, timeouts and logs.
- **Memory**: store preferences and operational state in Postgres, keep Notion as the source of truth for docs and tasks.

## Stack and deploy

- **Deploy via Docker Compose**:
  - `bot-core` - Telegram bot + API + business logic
  - `scheduler/worker` - background jobs (can be the same service, separate process is often easier)
  - `db` - Postgres container

## Responsibilities split

### Core (our code, the brain)

- Telegram update normalization to internal events
- Dialogs and FSM (draft tasks, step-by-step selection: category, priority, date)
- Intent Router / Planner / Policies (safety, confirmations, low-confidence handling)
- Tool Registry + deterministic Executor (retries, timeouts, logging)
- Unified API contract so N8N stays optional

### N8N (integration wiring)

- Receive and route events (webhooks, crons) and call internal endpoints
- Connectors to external systems (Notion, Google Calendar, Email, Search, etc.)
- Visualize branches and run fast experiments (throwaway branches)
- Ops flows (nightly sync, reindex, reports, admin jobs)

**What NOT to do in N8N** (to keep it easy to disable):

- Do not store dialog state (draft tasks, waiting for user choices, timeouts)
- Do not implement FSM and decision logic inside nodes
- Do not keep Tool Registry and security policies inside N8N
- Do not put critical business logic into Code nodes

### Worker (background processes)

- Heavy and long tasks: STT, sync, indexing, digests, reminders
- Queues and retries

## Storage

- **Postgres**:
  - `conversation_state` - dialog progress
  - `draft_tasks` - task drafts until clarified
  - `jobs/queue` - background jobs
  - `dedupe` - avoid duplicate processing (update_id, message_id)
  - `preferences/memory` - user defaults and habits
  - `reminder_log` - prevent reminder spam
- **Notion**: source of truth for tasks, ideas and documents (manual editing and visibility)

## Consistency model

- If the bot creates or updates content, it writes to Notion and updates its own cache (write-through).
- If you edit content in Notion manually, periodic sync pulls updates by `last_edited_time`.

## Suggested repository structure

This layout is a reference and can be implemented in Python or Node/TS.

```text
apps/
  bot_api/                  # webhook for incoming updates + health
  worker/                   # background jobs (queues/cron)

core/
  orchestrator/             # Router / Planner / Executor / Policies
  dialogs/                  # FSM and keyboards
  tools/                    # Tool Registry (what Planner selects)
  connectors/               # integrations (implementation of tools)
  storage/                  # Postgres adapters + migrations

infra/
  docker-compose.yml
  n8n/                      # optional exported workflows + env templates
```

## Agent loop (AI orchestration)

- **Intent Router (LLM)**: classifies input and returns confidence.
- **Planner (LLM, contract-limited)**: produces a `tool_calls[]` plan.
- **Executor (code)**: executes tool calls deterministically with retries and timeouts.
- **Policy/Guards (code)**: UX and safety rules (confirm deletions, ask on low confidence, etc.).

## Memory and preferences

- **Preference Extractor (LLM)**: proposes preference candidates after dialogs or explicit triggers.
- **Memory Store (Postgres)**: persists preferences and facts.
- **Memory Injector**: injects relevant preferences into planning context.

Rule of thumb: save automatically only clearly stated preferences or patterns repeated at least twice, otherwise keep as candidates until confirmed.


