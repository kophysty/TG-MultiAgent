# 2025-12-29 - Рефакторинг todo_bot.js (вынос логики в модули)

## Цель и рамки

- Снизить риски поломок и упростить дальнейшую разработку за счет уменьшения файла `core/dialogs/todo_bot.js`.
- Поведение бота не меняем, меняем только структуру кода.

## Ключевые решения

- Сохраняем внешний API: `registerTodoBot` остается в `core/dialogs/todo_bot.js`, импорт в `apps/todo_bot/src/main.js` не меняется.
- Самые крупные блоки (executor, callback_query, voice) выносим в отдельные файлы, чтобы следующий шаг (например memory injection) делался безопаснее.

## Что сделано

- Вынесены утилиты и нормализации в `core/dialogs/todo_bot_helpers.js`.
- Вынесен обработчик tool вызовов в `core/dialogs/todo_bot_executor.js` (фабрика `createToolExecutor`).
- Вынесен обработчик `callback_query` в `core/dialogs/todo_bot_callbacks.js` (фабрика `createCallbackQueryHandler`).
- Вынесен voice pipeline в `core/dialogs/todo_bot_voice.js` (функция `handleVoiceMessage`).
- `core/dialogs/todo_bot.js` теперь связывает эти части, но меньше и читаемее.

## Файлы

- `core/dialogs/todo_bot.js`
- `core/dialogs/todo_bot_helpers.js`
- `core/dialogs/todo_bot_executor.js`
- `core/dialogs/todo_bot_callbacks.js`
- `core/dialogs/todo_bot_voice.js`

## Как проверить

- Быстрая проверка загрузки модулей без запуска бота:
  - `node -e "require('./core/dialogs/todo_bot.js'); require('./core/dialogs/todo_bot_helpers.js'); require('./core/dialogs/todo_bot_executor.js'); require('./core/dialogs/todo_bot_callbacks.js'); require('./core/dialogs/todo_bot_voice.js'); console.log('ok');"`
- Ручная проверка в Telegram (при обычном запуске):
  - `/start`, `/list`, `/today`
  - создание задачи через AI (если `TG_AI=1`)
  - voice сообщение (если настроен `OPENAI_API_KEY`)

## Следующие шаги

- По желанию: дальше можно добить рефактор до конца и убрать дублирующиеся хелперы из `todo_bot.js`, полностью переключившись на `todo_bot_helpers.js`.








