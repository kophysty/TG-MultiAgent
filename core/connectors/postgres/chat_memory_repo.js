class ChatMemoryRepo {
  constructor({ pool }) {
    this._pool = pool;
  }

  async appendMessage({ chatId, role, text, tgMessageId = null }) {
    const safeChatId = Number(chatId);
    const safeRole = String(role || '').trim();
    const safeText = String(text || '').trim();
    const safeTgMessageId = tgMessageId === null || tgMessageId === undefined ? null : Number(tgMessageId);

    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    if (!safeRole) throw new Error('role is required');
    if (!safeText) throw new Error('text is required');

    const res = await this._pool.query(
      `
      INSERT INTO chat_messages (chat_id, role, text, tg_message_id, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, created_at
      `,
      [safeChatId, safeRole, safeText, Number.isFinite(safeTgMessageId) ? safeTgMessageId : null]
    );
    return res.rows?.[0] || null;
  }

  async listLastN({ chatId, limit = 50 }) {
    const safeChatId = Number(chatId);
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');

    const res = await this._pool.query(
      `
      SELECT id, chat_id, role, text, tg_message_id, created_at
      FROM chat_messages
      WHERE chat_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [safeChatId, safeLimit]
    );
    const rows = res.rows || [];
    rows.reverse(); // chronological order
    return rows;
  }

  async getSummary({ chatId }) {
    const safeChatId = Number(chatId);
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    const res = await this._pool.query(
      `SELECT chat_id, summary, updated_at, last_message_id FROM chat_summaries WHERE chat_id = $1`,
      [safeChatId]
    );
    return res.rows?.[0] || null;
  }

  async upsertSummary({ chatId, summary, lastMessageId = null }) {
    const safeChatId = Number(chatId);
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    const safeSummary = String(summary || '').trim();
    const safeLastMessageId = lastMessageId === null || lastMessageId === undefined ? null : Number(lastMessageId);

    await this._pool.query(
      `
      INSERT INTO chat_summaries (chat_id, summary, updated_at, last_message_id)
      VALUES ($1, $2, NOW(), $3)
      ON CONFLICT (chat_id)
      DO UPDATE SET summary = EXCLUDED.summary, updated_at = NOW(), last_message_id = EXCLUDED.last_message_id
      `,
      [safeChatId, safeSummary, Number.isFinite(safeLastMessageId) ? safeLastMessageId : null]
    );
  }

  async listChatsNeedingSummary({ limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 200);
    const res = await this._pool.query(
      `
      WITH latest AS (
        SELECT chat_id, MAX(id) AS max_id
        FROM chat_messages
        GROUP BY chat_id
      )
      SELECT l.chat_id, l.max_id AS last_message_id, s.last_message_id AS last_summarized_message_id
      FROM latest l
      LEFT JOIN chat_summaries s ON s.chat_id = l.chat_id
      WHERE COALESCE(s.last_message_id, 0) < l.max_id
      ORDER BY l.max_id DESC
      LIMIT $1
      `,
      [safeLimit]
    );
    return res.rows || [];
  }

  async purgeOldMessages({ ttlDays = 30 } = {}) {
    const safeTtlDays = Math.min(Math.max(1, Number(ttlDays) || 30), 3650);
    await this._pool.query(
      `DELETE FROM chat_messages WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(safeTtlDays)]
    );
  }
}

module.exports = { ChatMemoryRepo };



