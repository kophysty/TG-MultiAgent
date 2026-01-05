# План 07: pre-deploy + test tasks board mode + evals dev harness

## Почему это важно

- Pre-deploy фиксы обязательны, иначе voice в контейнере ломается (нет ffmpeg) и healthcheck в prod compose может постоянно фейлиться из-за неправильных путей.
- Test tasks board режим нужен для демонстраций без засвета рабочих задач.
- DevHarness нужен для контроля качества planner на реальных фразах и предотвращения регрессий при правках промптов и эвристик.

## Критичные pre-deploy блокеры

### 1) ffmpeg в Docker images

Текущие Dockerfile на `node:20-alpine` не ставят ffmpeg. Для voice пайплайна в контейнере это must-have.

### 2) Healthcheck path

В prod compose healthcheck вызывает `node core/runtime/healthcheck.js ...`, но WORKDIR контейнера сейчас `apps/todo_bot`. Нужно либо использовать абсолютный путь `/app/core/runtime/healthcheck.js`, либо задать `working_dir: /app` в сервисах.

### 3) Версия в docs

`docs/current/index.md` должен показывать актуальную версию, которую печатает `/start`.

## Test tasks board mode (только через клавиатуру)

### Принцип

- Только explicit toggle через reply keyboard.
- Режим per chat (безопасно).
- Без NLP маркеров "тестовая/демо" - логика чата не раздувается.

### Конфиг

- `NOTION_TASKS_DB_ID` - рабочая база.
- `NOTION_TASKS_TEST_DB_ID` - тестовая база (подтверждено: `2d3535c900f0818ebc77fd1fd3d9d6fa`).

### UX

- Кнопки: включить и выключить test mode.
- В test mode все ответы, где фигурируют задачи, маркируются `[TEST TASKS]`.

## DevHarness (dataset прогон planner)

### Что делаем

- Отдельный CLI, который:
- читает dataset кейсов
- прогоняет planner
- сравнивает output с ожиданиями
- печатает mismatch отчет и сводку

### Почему это не CI

- LLM вызовы дорогие и потенциально шумные. Инструмент нужен для ручных прогонов перед релизом и для разработки.