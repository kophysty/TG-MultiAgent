# 2026-01-02 - Dev runner: one command to run bot + worker

## Цель

Сделать одну dev команду, которая запускает одновременно todo bot и reminders worker для локальной разработки.

## Что сделано

- Добавлен `core/runtime/dev_runner.js`:
  - запускает `npm start` в `apps/todo_bot` и `apps/reminders_worker`
  - поддерживает флаги `--tests|--prod`, `--debug|--no-debug`, `--ai|--no-ai`
  - корректно останавливает оба процесса по Ctrl+C
- Обновлена документация:
  - `docs/current/commands.md`
  - `.cursor/commands/run-dev.md`

## Как проверить

Из корня репозитория:

```bash
node core/runtime/dev_runner.js --tests --debug --ai
```

Остановить: Ctrl+C.




