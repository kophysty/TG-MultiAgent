# 2026-01-14 - P0: social platform (unsupported) + archive idea idempotency

## Цель

- Убрать P0 проблемы из E2E:
  - Social platform: "Не понял платформу" на формулировках про "инстаграм(е)" и лучшее поведение на несуществующих платформах.
  - Inline: спам "Выбор устарел. Попробуй еще раз." на быстрых inline кликах.
  - Ideas: `notion.archive_idea` часто заканчивался "Не получилось выполнить действие в Notion."

## Ключевые факты и решения

- Social DB в Notion содержит опции платформ: `FB`, `Linkedin`, `TG  __ ForNoDevs`, `TikTok`, `Twitter`.
- `Instagram` в этих опциях отсутствует, поэтому корректное поведение на "инстаграм(е)" - переспросить и дать выбрать из поддерживаемых.
- Notion не позволяет редактировать уже архивированный page: повторный `PATCH pages/<id> { archived: true }` возвращает `HTTP 400 validation_error` с текстом про archived.

## Что сделано

- Social:
  - Для неподдерживаемой платформы текст уточнения стал явным: "Не вижу такую платформу среди доступных. Выбери из списка:".
- Inline callbacks:
  - Для "устаревшего выбора" убран `sendMessage` в чат, вместо этого используется `answerCallbackQuery` (toast).
- Ideas:
  - Повторное архивирование обрабатывается идемпотентно: при `validation_error` про archived бот отвечает "Похоже, эта идея уже в архиве."

## Измененные файлы (high-signal)

- `core/dialogs/todo_bot_helpers.js`
- `core/dialogs/todo_bot_executor.js`
- `core/dialogs/todo_bot_callbacks.js`
- `apps/todo_bot/package.json`
- `CHANGELOG.md`
- `HISTORY.md`
- `apps/evals/ds/14_2026-01-14_p0_social_focus.jsonl`
- `apps/evals/ds/15_2026-01-14_p0_ideas_archive_focus.jsonl`

## Как проверить

- E2E (точечно):
  - `node apps/evals/src/e2e_runner.js --dataset apps/evals/ds/14_2026-01-14_p0_social_focus.jsonl`
  - `node apps/evals/src/e2e_runner.js --dataset apps/evals/ds/15_2026-01-14_p0_ideas_archive_focus.jsonl`

## Follow-ups

- При желании можно улучшить отчетность cleanup ошибок в e2e раннере (P2), но это отдельно от P0 фиксов.

