# 2026-01-02 - Ideas/Social: fuzzy resolve, ссылки на элементы списка, Project и merge тегов

## Цель

- Починить кейс: после команды "Покажи мне все идеи" пользователь говорит "В первой идее ... добавь тег/проект ...", а бот не может найти идею.
- Сделать резолв и поиск для доменов Ideas и Social сопоставимым по качеству с Tasks:
  - RU voice -> LAT title (translit + варианты запросов)
  - локальный fallback по последним элементам
  - ссылки по индексу на элементы из последнего показанного списка

## Что сделано

### 1) Last shown lists для Ideas и Social

- Теперь бот запоминает последний показанный список:
  - Ideas: `lastShownIdeasListByChatId`
  - Social: `lastShownSocialListByChatId`
- Формат вывода списка для Ideas и Social стал нумерованным (`1. ...`, `2. ...`), чтобы можно было ссылаться на "первую/вторую" позицию.

### 2) Fuzzy поиск и резолв для Ideas/Social/Journal

- Добавлены функции:
  - `findIdeasFuzzyEnhanced`
  - `findSocialPostsFuzzyEnhanced`
  - `findJournalEntriesFuzzyEnhanced`
- В резолвах update/archive для Ideas и Social добавлена логика:
  - сначала пытаемся определить `pageId` по индексу (из текста "в первой идее" или по `taskIndex`)
  - затем используем fuzzy поиск

### 3) Update Idea: merge тегов и поле Project

- `NotionIdeasRepo` теперь поддерживает:
  - `Project` (select/multi_select/rich_text)
  - `getIdea()` для чтения текущего состояния
  - `ensureProjectOptions()` и `ensureTagsOptions()` для создания option при явном запросе
- В `notion.update_idea` добавлено:
  - поддержка `tags`, `area`, `project`
  - режим "добавь тег" (merge) - при подтверждении бот читает текущие теги, добавляет новые без дублей

### 4) Planner контекст и дефолтная модель

- В planner контекст добавлены:
  - last shown ideas list
  - last shown social posts list
- Дефолтная модель для todo bot теперь `gpt-4.1` если `TG_AI_MODEL` не задан.

## Ключевые файлы

- `core/dialogs/todo_bot.js`
- `core/dialogs/todo_bot_executor.js`
- `core/dialogs/todo_bot_callbacks.js`
- `core/dialogs/todo_bot_helpers.js`
- `core/connectors/notion/ideas_repo.js`
- `core/ai/agent_planner.js`

## Как проверить (ручной сценарий)

1) В чате бота:
   - "Покажи мне все идеи"
2) Затем:
   - "В первой идее добавь тег X"
   - или "В первой идее проставь проект telegram-ai.bot"
3) Ожидаемое:
   - бот резолвит идею по индексу
   - показывает подтверждение обновления
   - после подтверждения обновляет идею и отвечает "Готово. Обновил идею."





