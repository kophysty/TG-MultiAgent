-- Create subscriptions table for reminders.
-- Stores which Telegram chats are subscribed to reminders for a given bot mode.

CREATE TABLE IF NOT EXISTS subscriptions (
  chat_id BIGINT PRIMARY KEY,
  bot_mode TEXT NOT NULL DEFAULT 'tests', -- tests|prod
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_enabled ON subscriptions (enabled);


