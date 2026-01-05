class WorkContextRepo {
  constructor({ pool }) {
    this._pool = pool;
  }

  async getCache({ chatId, key }) {
    const safeChatId = Number(chatId);
    const safeKey = String(key || '').trim();
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    if (!safeKey) throw new Error('key is required');
    const res = await this._pool.query(
      `
      SELECT chat_id, key, payload, payload_hash, updated_at
      FROM work_context_cache
      WHERE chat_id = $1 AND key = $2
      `,
      [safeChatId, safeKey]
    );
    return res.rows?.[0] || null;
  }

  async upsertCache({ chatId, key, payload, payloadHash = null }) {
    const safeChatId = Number(chatId);
    const safeKey = String(key || '').trim();
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    if (!safeKey) throw new Error('key is required');
    const safePayload = payload && typeof payload === 'object' ? payload : { value: payload };
    const safeHash = payloadHash ? String(payloadHash) : null;

    await this._pool.query(
      `
      INSERT INTO work_context_cache (chat_id, key, payload, payload_hash, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, NOW())
      ON CONFLICT (chat_id, key)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        payload_hash = EXCLUDED.payload_hash,
        updated_at = NOW()
      `,
      [safeChatId, safeKey, JSON.stringify(safePayload), safeHash]
    );
  }
}

module.exports = { WorkContextRepo };




