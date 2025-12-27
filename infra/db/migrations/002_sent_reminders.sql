-- Create sent_reminders table for deduplication.
-- A reminder is uniquely identified by (chat_id, page_id, reminder_kind, remind_at).

CREATE TABLE IF NOT EXISTS sent_reminders (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  page_id TEXT NOT NULL,
  reminder_kind TEXT NOT NULL, -- daily_11, before_60m, day_before_23
  remind_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sent_reminders UNIQUE (chat_id, page_id, reminder_kind, remind_at),
  CONSTRAINT fk_sent_reminders_chat FOREIGN KEY (chat_id) REFERENCES subscriptions(chat_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sent_reminders_remind_at ON sent_reminders (remind_at);


