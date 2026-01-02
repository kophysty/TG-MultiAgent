-- Memory suggestions: candidates to save user preferences (UX buttons Save / Don't save).

CREATE TABLE IF NOT EXISTS memory_suggestions (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  kind TEXT NOT NULL, -- preference (extensible)
  candidate JSONB NOT NULL,
  candidate_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|rejected
  source_message_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ NULL,
  CONSTRAINT ck_memory_suggestions_kind CHECK (kind IN ('preference')),
  CONSTRAINT ck_memory_suggestions_status CHECK (status IN ('pending','accepted','rejected'))
);

-- Anti-spam: avoid repeating the same suggestion in the same chat while it is pending (or repeated decisions).
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_suggestions_chat_kind_status_hash
  ON memory_suggestions (chat_id, kind, status, candidate_hash);

CREATE INDEX IF NOT EXISTS idx_memory_suggestions_chat_created
  ON memory_suggestions (chat_id, created_at DESC);


