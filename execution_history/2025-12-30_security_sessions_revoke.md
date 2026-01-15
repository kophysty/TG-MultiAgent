# Sprint: Security sessions, notify and revoke

Date: 2025-12-30

## Goal

Добавить базовый слой безопасности для Telegram бота: уведомления админам о новых чатах, реестр известных чатов (sessions) и возможность revoke/unrevoke chatId.

## Scope

- In scope:
  - Sessions store (Postgres если есть `POSTGRES_URL`, иначе file fallback).
  - Notify админам при первом появлении нового chatId.
  - Admin команды `/sessions`, `/revoke`, `/revoke_here`, `/unrevoke`, `/security_status`.
  - Security gate для message и callback_query, блокировка revoked чатов.
- Out of scope:
  - Настоящая привязка к устройству (Telegram Bot API не дает device id).
  - Enforce allowlist по умолчанию (только заложили поля/структуру).

## Key decisions

- Decision: sessions = chatId + метаданные, без device id
  - Rationale: Telegram API не дает надежных данных об устройстве.
- Decision: storage auto
  - Rationale: если есть Postgres, используем его для надежности; иначе продолжаем работать через локальный файл.

## Changes implemented

- `core/runtime/chat_security.js`
  - единый слой: выбор backend, notify админам, revoke/unrevoke, sessions list.
- `core/connectors/postgres/chat_security_repo.js`
  - Postgres repo для sessions и audit.
- `core/runtime/security_store_file.js`
  - file fallback хранилище `data/security/sessions.json`.
- `infra/db/migrations/003_chat_security.sql`
  - миграции таблиц `chat_security_chats` и `chat_security_audit`.
- `core/dialogs/todo_bot.js`
  - security gate для message и callback_query
  - admin команды security
- `core/dialogs/todo_bot_callbacks.js`
  - блокировка callback действий для revoked чатов.

## Validation

- Steps:
  - Установить `TG_ADMIN_CHAT_IDS` в chatId админа.
  - Написать боту из нового chatId - админ получает уведомление.
  - В админ чате: `/sessions` - виден новый чат.
  - `/revoke <chatId>` - чат блокируется.
  - Попробовать нажать inline кнопку или отправить сообщение из revoked чата - бот не выполняет действия.
  - `/unrevoke <chatId>` - чат снова работает.

## Follow-ups

- Добавить allowlist режимы `warn/enforce` при необходимости.








