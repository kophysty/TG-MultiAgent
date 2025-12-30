-- Chat security sessions store (admin notifications, revoke, audit)

CREATE TABLE IF NOT EXISTS chat_security_chats (
  chat_id BIGINT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chat_type TEXT NULL,
  chat_title TEXT NULL,
  last_from_user_id BIGINT NULL,
  last_from_username TEXT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ NULL,
  revoked_by_chat_id BIGINT NULL,
  revoked_reason TEXT NULL,
  allowlisted BOOLEAN NOT NULL DEFAULT FALSE,
  allowlisted_at TIMESTAMPTZ NULL,
  allowlisted_by_chat_id BIGINT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_security_chats_last_seen_at ON chat_security_chats (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_security_chats_revoked ON chat_security_chats (revoked) WHERE revoked = TRUE;

CREATE TABLE IF NOT EXISTS chat_security_audit (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_chat_id BIGINT NULL,
  action TEXT NOT NULL,
  target_chat_id BIGINT NULL,
  details JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_security_audit_ts ON chat_security_audit (ts DESC);


