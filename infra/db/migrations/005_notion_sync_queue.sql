-- Create notion_sync_queue for write-through updates to Notion with retries.
-- Each (kind, external_id) is unique to collapse repeated updates.

CREATE TABLE IF NOT EXISTS notion_sync_queue (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL, -- pref_page_upsert|profile_upsert
  external_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT NULL,
  attempt INT NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notion_sync_queue_kind_external UNIQUE (kind, external_id)
);

CREATE INDEX IF NOT EXISTS idx_notion_sync_queue_next_run_at ON notion_sync_queue (next_run_at);


