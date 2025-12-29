class RemindersRepo {
  constructor({ pool }) {
    this._pool = pool;
  }

  async upsertSubscription({ chatId, botMode = 'tests', enabled = true }) {
    await this._pool.query(
      `
      INSERT INTO subscriptions (chat_id, bot_mode, enabled, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (chat_id)
      DO UPDATE SET bot_mode = EXCLUDED.bot_mode, enabled = EXCLUDED.enabled, updated_at = NOW()
      `,
      [Number(chatId), String(botMode || 'tests'), Boolean(enabled)]
    );
  }

  async setSubscriptionEnabled({ chatId, enabled }) {
    await this._pool.query(
      `UPDATE subscriptions SET enabled = $2, updated_at = NOW() WHERE chat_id = $1`,
      [Number(chatId), Boolean(enabled)]
    );
  }

  async listEnabledSubscriptions() {
    const res = await this._pool.query(
      `SELECT chat_id, bot_mode FROM subscriptions WHERE enabled = TRUE`
    );
    return (res.rows || []).map((r) => ({
      chatId: Number(r.chat_id),
      botMode: String(r.bot_mode || 'tests'),
    }));
  }

  async tryInsertSentReminder({ chatId, pageId, reminderKind, remindAt }) {
    const res = await this._pool.query(
      `
      INSERT INTO sent_reminders (chat_id, page_id, reminder_kind, remind_at, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (chat_id, page_id, reminder_kind, remind_at) DO NOTHING
      RETURNING id
      `,
      [Number(chatId), String(pageId), String(reminderKind), remindAt]
    );
    return Boolean(res.rowCount);
  }

  async deleteSentReminder({ chatId, pageId, reminderKind, remindAt }) {
    await this._pool.query(
      `DELETE FROM sent_reminders WHERE chat_id = $1 AND page_id = $2 AND reminder_kind = $3 AND remind_at = $4`,
      [Number(chatId), String(pageId), String(reminderKind), remindAt]
    );
  }
}

module.exports = { RemindersRepo };



