-- Work context cache (per chat_id): compact payload used for planner injection.

CREATE TABLE IF NOT EXISTS work_context_cache (
  chat_id BIGINT NOT NULL,
  key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, key)
);

CREATE INDEX IF NOT EXISTS idx_work_context_cache_updated_at
  ON work_context_cache (updated_at DESC);



