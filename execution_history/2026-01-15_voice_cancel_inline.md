# Voice cancel inline (отмена распознавания)

## Цель

Добавить возможность отменить обработку voice сообщения, пока оно скачивается, конвертируется или распознается.

Требования UX:

- Кнопка должна быть inline, под статус сообщением.
- При отмене бот не должен ничего писать в чат.
- При отмене статус сообщение должно быть удалено.
- Отмена должна экономить токены, если нажата до STT и AI.

## Реализация

### Inline кнопка "Отмена"

- В `core/dialogs/todo_bot_voice.js` статус сообщение теперь отправляется с inline клавиатурой:
  - `Отмена` -> callback_data `vc:<actionId>`
- При обновлении текста статус сообщения через `editMessageText` Telegram может сбрасывать inline клавиатуру, если не передать `reply_markup`.
  - Поэтому при смене статусов (download -> convert -> stt) мы каждый раз переустанавливаем `reply_markup`, чтобы кнопка не исчезала.

### Voice job state и abort

- В `core/dialogs/todo_bot_voice.js` добавлен in-memory реестр voice jobs:
  - `actionId`
  - `AbortController`
  - `statusMessageId`
  - TTL очистка, чтобы не копить старые записи

- На каждом шаге перед тяжелыми действиями есть проверка cancel.
- При отмене:
  - вызывается `abortController.abort()`
  - статус сообщение удаляется
  - дальнейшая обработка завершается молча

### Abort для download, ffmpeg и STT

Чтобы отмена реально останавливала работу:

- `core/connectors/telegram/files.js`: добавлен `signal`, прокинут в `axios.get` при скачивании файла Telegram.
- `core/connectors/stt/ffmpeg.js`: добавлен `signal`, при abort убиваем `ffmpeg` процесс.
- `core/connectors/stt/openai_whisper.js`: добавлен `signal`, прокинут в `axios.post` для `/v1/audio/transcriptions`.

### Обработка callback

- `core/dialogs/todo_bot_callbacks.js` перехватывает `vc:<actionId>`:
  - `answerCallbackQuery` без текста
  - отменяет voice job
  - удаляет сообщение со статусом

## Файлы изменены

- `core/dialogs/todo_bot_voice.js`
- `core/dialogs/todo_bot_callbacks.js`
- `core/connectors/telegram/files.js`
- `core/connectors/stt/ffmpeg.js`
- `core/connectors/stt/openai_whisper.js`
- `docs/current/voice.md`
- `core/dialogs/todo_bot_helpers.js` (расширен `safeEditStatus` для поддержки `reply_markup`)
- `apps/todo_bot/package.json`
- `CHANGELOG.md`
- `HISTORY.md`

## Как проверить

1) Отправить voice, сразу нажать "Отмена".
2) Убедиться, что:
   - статус сообщение удалилось
   - бот больше ничего не написал
   - в логах нет вызова STT и дальше

