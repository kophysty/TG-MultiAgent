## Цель

- Дать пользователю понятный способ **удалять/чистить preferences** (и memory notes) из “постоянной памяти”.
- Починить синхронизацию так, чтобы удаление preference в Notion **не “воскрешалось”** обратно из Postgres.

## Что было не так

- Если удалить/архивировать страницу preference в Notion (Trash), то она **перестает попадать** в `databases/{id}/query`.
- Поэтому воркер не видел удаление и Postgres продолжал считать preference активным.
- При следующем push (например из `/worker_run`) preference снова создавался в Notion.

## Что сделано

### 1) Синк удалений Notion → Postgres

- В `apps/reminders_worker` добавлен reconcile шаг:
  - периодически берет batch из `preferences_sync` с `notion_page_id`
  - делает `GET /pages/{id}`
  - если `archived=true` (или 404) → ставит `active=false` в Postgres и обновляет `preferences_sync.last_seen_notion_edited_at`

### 2) Инструмент удаления в Telegram

- Добавлена админ-команда `/prefs_rm <номер|key>`:
  - `/prefs_pg` теперь показывает список с номерами и сохраняет “last shown” список
  - `/prefs_rm` выключает preference в Postgres (`active=false`) и enqueue `pref_page_upsert` в Notion (Active=false)

### 3) Уточнение для /worker_run

- При enqueue массового `pref_page_upsert` из `/worker_run` `updatedAt` теперь берется из `preferences.updated_at`, а не `NOW()`.
  - Это важно, чтобы “удаление в Notion” могло корректно выигрывать по времени.

## Как пользоваться (коротко)

- **Самый простой путь:** в Notion Preferences DB снять галочку `Active`.
- **Из Telegram (admin):**
  - `/prefs_pg`
  - `/prefs_rm 2`

## Файлы

- `core/dialogs/todo_bot.js`
- `core/connectors/postgres/preferences_repo.js`
- `core/connectors/notion/preferences_repo.js`
- `apps/reminders_worker/src/main.js`
- `docs/current/memory.md`
- `docs/current/commands.md`
- `CHANGELOG.md`, `HISTORY.md`

