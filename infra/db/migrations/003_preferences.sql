-- Create preferences table for Memory module.
-- Stores user preferences (by chat_id) as JSON + a short human-friendly value.

CREATE TABLE IF NOT EXISTS preferences (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global', -- global|project (extensible)
  category TEXT NULL,
  pref_key TEXT NOT NULL,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  value_human TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'postgres', -- postgres|notion
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_preferences_chat_scope_key ON preferences (chat_id, scope, pref_key);
CREATE INDEX IF NOT EXISTS idx_preferences_chat_active ON preferences (chat_id, active);
CREATE INDEX IF NOT EXISTS idx_preferences_updated_at ON preferences (updated_at);








