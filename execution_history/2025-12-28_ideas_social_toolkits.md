#+#+#+#+########################################
# Sprint: Ideas + Social Media Planner toolkits
#
# Date: 2025-12-28
#
#+#+#+#+########################################

## Goal

Extend the existing "single planner + deterministic executor" architecture to support multiple Notion databases:

- Tasks DB (existing)
- Ideas DB
- Social Media Planner DB

## Scope

- In scope:
  - Add connectors (repos) for Ideas DB and Social Media Planner DB
  - Add tool support in the AI planner prompt for Ideas and Social tools
  - Extend the executor to run Ideas and Social CRUD operations
  - Add a platform picker (inline keyboard) when creating a social post without `Platform`
  - Add duplicate check for create actions (tasks, ideas, social posts) with explicit confirmation
- Out of scope:
  - Full ALEX DB reading/summarization
  - Dedicated multi-agent LLM subagents

## Key decisions

- Decision: One LLM planner, multiple domain toolkits (tasks/ideas/social)
  - Rationale: Lower latency and cost, easier debugging, deterministic executor remains the source of truth.

- Decision: "Delete" for ideas/social is archiving
  - Rationale: Preserve history in Notion, align with user preference.

## Implementation summary

- New repos:
  - `core/connectors/notion/ideas_repo.js`
  - `core/connectors/notion/social_repo.js`
- Bot wiring:
  - `apps/todo_bot/src/main.js` instantiates and passes repos for tasks/ideas/social.
- Planner prompt:
  - `core/ai/agent_planner.js` now includes tool names and rules for Ideas and Social domains.
- Executor:
  - `core/dialogs/todo_bot.js` handles:
    - list/create/update/archive for ideas
    - list/create/update/archive for social posts
    - platform picker when platform is missing
    - duplicate check on create with confirm/cancel

## Env vars

- `NOTION_TASKS_DB_ID`
- `NOTION_IDEAS_DB_ID`
- `NOTION_SOCIAL_DB_ID`
- `NOTION_TOKEN`
- `OPENAI_API_KEY` (only needed when `TG_AI=1`)

## Validation

- Start bot:
  - `TG_BOT_MODE=tests TG_DEBUG=1 TG_AI=1 TG_AI_MODEL=gpt-4.1-mini npm start`
- Test examples:
  - "покажи идеи"
  - "добавь идею: сделать чеклист релиза"
  - "покажи посты tiktok"
  - "добавь пост: релиз бота" (should ask to pick platform)
  - Create the same title twice: bot should ask to confirm a duplicate.

## Follow-ups

- Add richer formatting for Ideas/Social lists (include status, dates, and URLs).
- Implement a consistent "pick from list by index" for Ideas and Social, similar to Tasks lastShownList.


