-- Operational event log (sanitized): trace_id correlation + high-signal events.

CREATE TABLE IF NOT EXISTS event_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trace_id TEXT NOT NULL,
  chat_id BIGINT NULL,
  tg_update_id BIGINT NULL,
  tg_message_id BIGINT NULL,
  component TEXT NOT NULL,
  event TEXT NOT NULL,
  level TEXT NOT NULL,
  duration_ms INT NULL,
  payload JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_event_log_ts_desc
  ON event_log (ts DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_chat_ts_desc
  ON event_log (chat_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_trace_id
  ON event_log (trace_id);


