-- Chat memory tables: raw chat messages + per-chat rolling summary.
-- IMPORTANT: store only sanitized text (no tokens/keys).

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  role TEXT NOT NULL, -- user|assistant|system
  text TEXT NOT NULL,
  tg_message_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_chat_messages_role CHECK (role IN ('user','assistant','system'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created_at ON chat_messages (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_tg_message_id ON chat_messages (chat_id, tg_message_id);

CREATE TABLE IF NOT EXISTS chat_summaries (
  chat_id BIGINT PRIMARY KEY,
  summary TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_id BIGINT NULL
);



