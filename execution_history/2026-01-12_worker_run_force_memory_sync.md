## Цель

- Перестать ждать `TG_MEMORY_SYNC_SECONDS` (по умолчанию 1800с) при тестировании memory.
- Добавить быстрый способ форсировать синхронизацию Preferences между Postgres и Notion.

## Что сделано

- Добавлена админ-команда `/worker_run` в todo bot:
  - ставит в `notion_sync_queue` специальную задачу `kind=worker_run`
  - дополнительно ставит `pref_page_upsert` в очередь для всех текущих active preferences по текущему чату, чтобы Notion UI догнал Postgres
  - reminders worker подхватывает ее в течение `TG_REMINDERS_POLL_SECONDS` (по умолчанию 60с)
  - выполняет `memoryTick` сразу, без ожидания расписания
  - отправляет отчет в чат (сколько push/pull/queue осталось)

- Исправлен push в Notion для заметок памяти:
  - `category=memory_note` не выставляется в Notion (иначе Notion select может отклонить апдейт)

- Добавлены отладочные логи в reminders worker:
  - включаются через `TG_DEBUG=1`
  - показывают snapshot тика (сколько подписок, сколько задач/постов), статистику memory sync (push/pull), а также итог по отправкам напоминаний

## Как проверить

1) В админ-чате отправить `/worker_run`.
2) Подождать до 1 минуты.
3) Убедиться, что пришел отчет от reminders worker.
4) Проверить Notion Preferences DB: должны появиться новые записи, которые были в Postgres, но не были видны в Notion.

Логи воркера:

1) Запусти воркер с `TG_DEBUG=1`.
2) В терминале должны появляться строки вида `[tg_debug] worker ...`:
   - `config`
   - `tick_snapshot`
   - `tick_send` (если были отправки)
   - `memory_tick_start`, `memory_push_done`, `memory_pull_done`, `memory_tick_forced_done` (при /worker_run)

## Файлы

- `core/dialogs/todo_bot.js`
- `apps/reminders_worker/src/main.js`
- `docs/current/commands.md`
- `CHANGELOG.md`
- `HISTORY.md`

