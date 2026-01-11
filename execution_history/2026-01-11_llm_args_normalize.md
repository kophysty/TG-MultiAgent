# 2026-01-11: Нормализация аргументов tools для совместимости между моделями

## Goal and scope

- Повысить совместимость planner вывода между разными моделями (например `gpt-4.1` и `gpt-5.1`) без изменения бизнес логики tools.
- Перейти на версию todo bot `0.2.0`, так как накопилось много существенных изменений.
- Зафиксировать в документации разницу между OpenAI Chat Completions и Responses API.

## Key decisions

- Нормализацию делаем на уровне planner (после `JSON.parse` и перед возвратом плана), чтобы:
  - поведение было одинаковым в рантайме
  - `apps/evals` сравнивал уже нормализованный план
- Нормализация сделана "узкой" и безопасной:
  - только ключевые алиасы аргументов
  - маппинг зависит от `tool.name`, чтобы не ломать разные схемы (например tasks vs social vs journal)

## Implementation summary

- Добавлена нормализация аргументов tool планов в `core/ai/agent_planner.js`.
- Поднята версия `apps/todo_bot/package.json` до `0.2.0` (команда `/start` показывает новую версию).
- Обновлена документация `docs/current/ai.md` с кратким объяснением Chat Completions vs Responses API и почему structured ответы важны.

## Files changed

- `core/ai/agent_planner.js`
- `apps/todo_bot/package.json`
- `docs/current/ai.md`

## How to validate

### Evals (planner)

Пример:

- `node apps/evals/src/main.js --dataset apps/evals/ds/01_2026-01-06_planner_150.jsonl --limit 50 --model gpt-5.1`
- `node apps/evals/src/main.js --dataset apps/evals/ds/01_2026-01-06_planner_150.jsonl --model gpt-5.1`

Ожидаемо: меньше или нет mismatch по ключам аргументов (например `date` vs `dueDate` для list tasks).

### Bot

- Перезапусти todo bot.
- В TG: `/start`.
- Проверь строку `Версия: v0.2.0`.

## Follow ups

- При добавлении новых tool схем расширять нормализацию точечно, только по необходимости и только в рамках конкретного `tool.name`.

