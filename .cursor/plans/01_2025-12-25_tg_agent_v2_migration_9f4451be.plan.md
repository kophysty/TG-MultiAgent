---
name: 01_2025-12-25_tg_agent_v2_migration
overview: Взять код из репозитория TG_agent_v2 как базу, разложить по целевой структуре папок TG-MultiAgent и довести до работающего Telegram polling бота с CRUD задач в Notion без AI.
todos:
  - id: access-audit
    content: Получить доступ к TG_agent_v2, клонировать во временную папку (не коммитить) и составить карту модулей
    status: completed
  - id: scaffold-structure
    content: Создать целевую структуру apps/ и core/ и модуль конфигурации env
    status: completed
    dependencies:
      - access-audit
  - id: migrate-telegram-polling
    content: Перенести Telegram polling entrypoint, handlers и inline keyboards в core/dialogs и core/connectors/telegram
    status: completed
    dependencies:
      - scaffold-structure
  - id: migrate-notion-crud
    content: Перенести Notion интеграцию и привязать CRUD к базе Tasks Base MultiAgent
    status: completed
    dependencies:
      - scaffold-structure
  - id: smoke-test
    content: Прогнать ручной e2e тест бота без AI на @todofortests_bot (создание, правка, удаление задач)
    status: completed
    dependencies:
      - migrate-telegram-polling
      - migrate-notion-crud
  - id: infra-up
    content: Подготовить и при необходимости поднять infra (postgres + n8n) через docker compose
    status: completed
    dependencies:
      - scaffold-structure
---

# План миграции TG_agent_v2 -> TG-MultiAgent (без AI)

## Цель

- Взять существующий бот из `TG_agent_v2` как основу.
- Переложить код в целевую структуру папок (как в `docs/repo-structure.md`).
- Поднять минимально рабочий бот в режиме polling на `@todofortests_bot`.
- CRUD задач в Notion через базу `Tasks Base MultiAgent`.
- Без AI, без Planner, только детерминированная логика и существующие меню.

## Входные данные и договоренности

- Доступ к коду: ты даешь **collaborator read** к `kophysty/TG_agent_v2`. 
- Историю git переносить не нужно: переносим код как snapshot.
- Тестируем через polling.

## Как будем анализировать старый репозиторий

- Клонируем `TG_agent_v2` во временную папку внутри этого проекта, например `sources/tg_agent_v2/` и добавляем `sources/` в `.gitignore`, чтобы не коммитить исходник.
- Выделяем:
- entrypoint бота и транспорт (polling/webhook)
- роутинг команд и callback data
- билдеры inline keyboards
- слой Notion: токен, db id, маппинг полей, операции create/update/delete/query

## Целевая структура в TG-MultiAgent

Ориентируемся на `docs/repo-structure.md`:

- `apps/` - точки входа
- `apps/bot_polling/` - запуск polling (на время старта)
- `core/dialogs/` - сценарии и клавиатуры
- `core/connectors/telegram/` - отправка сообщений, нормализация апдейтов
- `core/connectors/notion/` - Notion repo для задач (CRUD)
- `infra/` - compose и окружение (у нас уже есть `infra/docker-compose.yml`)

Важно: без AI мы можем сделать минимальный `core/orchestrator/router.*` как простой command router.

После тестрования - будет добавлять AI и транскрибацию во флоу. 

## План переноса (пошагово)

1) Доступ и аудит

- Получить доступ к `TG_agent_v2`. (залогинился тут во встроенном браузере, этого достаточно?)
- Клонировать репозиторий в `sources/tg_agent_v2/` (в git не трекаем).
- Составить таблицу соответствия: старые файлы/модули -> новые папки.

2) Скелет проекта

- Создать `apps/` и `core/` в нашем репозитории.
- Добавить модуль конфигурации (env) и перечислить нужные переменные в README/docs.

3) Telegram слой (polling)

- Вынести Telegram запуск в `apps/bot_polling/`.
- Перенести существующие handlers и inline меню в `core/dialogs/*`.
- Сделать единый слой отправки сообщений (обертка над библиотекой из старого проекта) в `core/connectors/telegram/`.

4) Notion слой (CRUD)

- Перенести Notion клиент в `core/connectors/notion/`.
- Перевести операции CRUD на базу `Tasks Base MultiAgent`.
- Зашить маппинг полей базы как конфиг (без хардкода по всему проекту):
- `NOTION_TASKS_DB_ID=2d3535c900f0818ebc77fd1fd3d9d6fa`
- свойства: `Name`, `Status`, `Priority`, `Tags`, `Due Date`, `PMD`, `Assignee`, `Team`

5) Дымовой тест без AI

- Запустить polling на `@todofortests_bot`.
- Прогнать сценарии:
- `/start`
- создание задачи через меню
- изменение статуса/приоритета/тегов
- удаление задачи
- проверка, что изменения отражаются в Notion базе

6) Инфра

- Поднять `postgres` и `n8n` через `infra/docker-compose.yml` (если нужно для состояния или экспериментов).
- Пока без интеграции n8n в поток, только окружение.

7) Коммиты

- Делать небольшие коммиты по слоям (Telegram, Notion, меню, конфиг).
- Перед каждым commit/push спрашивать разрешение.
- После каждого commit обновлять `CHANGELOG.md` и `HISTORY.md`.

## Критерии готовности

- Бот в polling поднимается локально.