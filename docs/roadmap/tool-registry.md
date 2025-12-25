# Инструменты должны быть реестром, а не хардкодом

Сейчас инструменты часто выглядят как "мы знаем, что дернуть". Агенту нужен `Tool Registry`.

Примеры tool-ов:

- `notion.*` (через MCP или напрямую)
- `stt.transcribe`
- `tasks.plan_day`
- `tasks.schedule_reminders`
- `memory.save_preference`
- `telegram.ask_clarify` / `telegram.update_status`

Agent Planner выбирает tool-ы из списка и параметризует их.

## Минимальная архитектура важнее multi-tenant

### Single-tenant, но с "пространством" в данных

- не делай users/tenants таблицы сейчас
- сделай один `workspace_id = "default"` (константа)
- добавь опциональное поле `workspace_id` только там, где это дешево (например: documents, doc_chunks, preferences, tasks_cache)
- в коде не городи RBAC - всегда используешь `"default"`

Это не multi-tenant, это "зарезервировали место под будущее".

### StorageAdapter/Repository слой и Tool Registry

Сделай StorageAdapter/Repository слой и Tool Registry. Это реально переиспользуется и в personal, и в self-hosted, и в SaaS - без боли.


