# 2026-01-07 - Evals DevHarness + фиксы planner (list vs find)

## Цель

- Добавить DevHarness для прогонов planner по dataset и быстрого поиска регрессий.
- Починить поведение planner: запросы вида "покажи задачи про X" должны идти в `notion.list_tasks` (с `queryText`), а не в `notion.find_tasks`.
- Сделать датасет менее хрупким к разговорным вариантам (регистр, падежи, формат даты).

## Что сделано

- DevHarness:
  - Добавлен пакет `apps/evals` (CLI) для прогона `planAgentAction` по jsonl dataset и генерации отчета mismatch.
  - Добавлены:
    - `argsAnyOf` (несколько допустимых вариантов args)
    - regex matcher в ожиданиях
    - мягкая нормализация (падежи, регистр, ISO даты)
    - throttle и retry/backoff для 429 и transient сетевых ошибок

- Dataset:
  - Добавлен генератор `apps/evals/src/gen_ds_01.js`.
  - Добавлен датасет `apps/evals/ds/01_2026-01-06_planner_150.jsonl` (150 кейсов).
  - Контекст времени фиксирован, чтобы относительные даты были детерминированы:
    - утро: 10:55 MSK
    - около 12:00: 12:05 MSK

- Planner behavior:
  - Усилены правила в prompt: "покажи задачи про/по слову X" всегда `notion.list_tasks` с `args.queryText`.
  - `notion.find_tasks` оставлен для явного "найди/поиск" и резолва одной задачи по имени без show/list intent.

## Файлы

- `apps/evals/*`
- `core/ai/agent_planner.js`
- `docs/current/commands.md`
- `CHANGELOG.md`
- `HISTORY.md`
- `.gitignore`

## Как проверить

1) Прогон sample:

```bash
node apps/evals/src/main.js --dataset apps/evals/ds/sample.jsonl --only-mismatch
```

2) Большой прогон (защита от 429):

```bash
node apps/evals/src/main.js --dataset apps/evals/ds/01_2026-01-06_planner_150.jsonl --only-mismatch --sleep-ms 400 --retries 6 --retry-base-ms 1500
```

Ожидаемо: `mismatch=0` и `error=0`.

## Заметки

- Отчеты пишутся в `data/evals/` и не попадают в git (папка в `.gitignore`).


