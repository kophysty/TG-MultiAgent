# 2026-01-05 - Admin команды: commands, errors, execution_history

## Цель

- Дать ToDoBot admin-only команды для самодиагностики и быстрого просмотра истории изменений прямо из Telegram.

## Изменения

- Добавлены admin-only команды:
  - `/commands` - список админских команд.
  - `/errors [hours]` - последние ошибки из Postgres `event_log` по текущему чату.
  - `/history_list [N]` - список sprint файлов в `execution_history/`.
  - `/history_show <N|file>` - краткий конспект выбранного sprint файла.
  - `/history_summary <days>` - короткая сводка по sprint файлам за последние N дней (по датам в именах файлов).

- UX:
  - Подсказки по `history_*` используют примеры без скобок, чтобы было понятно что вводить (например `/history_show 3`).

- Устойчивость запуска и диагностика:
  - На старте добавлен retry для Notion запроса `getOptions` (защита от transient `ECONNRESET` и таймаутов).
  - При фатальной ошибке запуска todo bot отправляет уведомление в чаты из `TG_ADMIN_CHAT_IDS` (sanitized текст ошибки).

- Reply keyboard:
  - Для чатов из `TG_ADMIN_CHAT_IDS` кнопка `/list` заменена на `/commands`.
  - Для обычных чатов кнопка `/list` сохранена.

## Файлы

- `core/dialogs/todo_bot.js`
- `docs/current/commands.md`
- `execution_history/index.md`
- `apps/todo_bot/package.json`
- `CHANGELOG.md`
- `HISTORY.md`

## Как проверить

1) В админском чате:
   - Нажать `Start` или отправить `/start`.
   - Убедиться, что в клавиатуре есть `/commands` вместо `/list`.

2) Выполнить:
   - `/commands` - должен прийти список admin-only команд.
   - `/history_list` - должен прийти список файлов.
   - `/history_show 1` - должен прийти краткий конспект выбранного sprint файла.
   - `/history_summary 3` - должен прийти summary за последние 3 дня (если есть файлы в диапазоне).

3) Для `/errors`:
   - Убедиться, что настроен `POSTGRES_URL` и применены миграции с таблицей `event_log`.
   - Выполнить `/errors` или `/errors 24`.
   - Ожидаемо: список ошибок за период, либо сообщение что ошибок нет.

4) Проверка уведомления о фатальной ошибке запуска:
   - Временно сломать доступ к Notion (например убрать `NOTION_TOKEN`) и запустить bot.
   - Ожидаемо: сообщение "Todo bot: ошибка запуска" придет в чаты из `TG_ADMIN_CHAT_IDS`.

## Заметки

- Команды доступны только чатам из `TG_ADMIN_CHAT_IDS`.
- `/errors` использует `event_log` (структурные записи, payload sanitized), а не stdout логи.


