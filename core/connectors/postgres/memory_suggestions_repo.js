const crypto = require('crypto');

function stableStringify(value) {
  // Minimal stable JSON stringify: sorts object keys recursively.
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${parts.join(',')}}`;
}

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex');
}

function computeCandidateHash(candidate) {
  return md5(stableStringify(candidate || {}));
}

class MemorySuggestionsRepo {
  constructor({ pool }) {
    this._pool = pool;
  }

  async createPreferenceSuggestion({ chatId, candidate, sourceMessageId = null }) {
    const safeChatId = Number(chatId);
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    const cand = candidate && typeof candidate === 'object' ? candidate : { value: candidate };
    const candidateHash = computeCandidateHash(cand);
    const safeSourceMessageId = sourceMessageId === null || sourceMessageId === undefined ? null : Number(sourceMessageId);

    const res = await this._pool.query(
      `
      INSERT INTO memory_suggestions (
        chat_id, kind, candidate, candidate_hash, status, source_message_id, created_at
      )
      VALUES ($1, 'preference', $2::jsonb, $3, 'pending', $4, NOW())
      ON CONFLICT (chat_id, kind, status, candidate_hash)
      DO UPDATE SET
        -- keep it pending, refresh timestamp so it stays visible/recent
        created_at = NOW(),
        source_message_id = COALESCE(EXCLUDED.source_message_id, memory_suggestions.source_message_id)
      RETURNING id, chat_id, kind, candidate, candidate_hash, status, source_message_id, created_at, decided_at
      `,
      [safeChatId, JSON.stringify(cand), candidateHash, Number.isFinite(safeSourceMessageId) ? safeSourceMessageId : null]
    );

    return res.rows?.[0] || null;
  }

  async getSuggestionById({ id, chatId }) {
    const safeId = Number(id);
    const safeChatId = Number(chatId);
    if (!Number.isFinite(safeId)) return null;
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    const res = await this._pool.query(
      `
      SELECT id, chat_id, kind, candidate, candidate_hash, status, source_message_id, created_at, decided_at
      FROM memory_suggestions
      WHERE id = $1 AND chat_id = $2
      `,
      [safeId, safeChatId]
    );
    return res.rows?.[0] || null;
  }

  async decideSuggestion({ id, chatId, status }) {
    const safeId = Number(id);
    const safeChatId = Number(chatId);
    const safeStatus = String(status || '').trim();
    if (!Number.isFinite(safeId)) throw new Error('id is required');
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    if (safeStatus !== 'accepted' && safeStatus !== 'rejected') throw new Error('status must be accepted|rejected');

    const res = await this._pool.query(
      `
      UPDATE memory_suggestions
      SET status = $3, decided_at = NOW()
      WHERE id = $1 AND chat_id = $2 AND status = 'pending'
      RETURNING id, chat_id, kind, candidate, candidate_hash, status, source_message_id, created_at, decided_at
      `,
      [safeId, safeChatId, safeStatus]
    );
    return res.rows?.[0] || null;
  }
}

module.exports = { MemorySuggestionsRepo, computeCandidateHash };



