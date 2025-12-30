-- Create preferences_sync mapping table.
-- Tracks Notion page ids and hashes for bidirectional sync.

CREATE TABLE IF NOT EXISTS preferences_sync (
  external_id TEXT PRIMARY KEY, -- pref:<chat_id>:<scope>:<key>
  chat_id BIGINT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  pref_key TEXT NOT NULL,
  notion_page_id TEXT NULL,
  last_pushed_hash TEXT NULL,
  last_pushed_at TIMESTAMPTZ NULL,
  last_seen_notion_edited_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_preferences_sync_chat_scope_key ON preferences_sync (chat_id, scope, pref_key);
CREATE INDEX IF NOT EXISTS idx_preferences_sync_notion_page_id ON preferences_sync (notion_page_id);
CREATE INDEX IF NOT EXISTS idx_preferences_sync_last_seen ON preferences_sync (last_seen_notion_edited_at);


