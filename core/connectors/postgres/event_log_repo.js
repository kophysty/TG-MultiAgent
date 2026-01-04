const { sanitizeForEventLog, sanitizeTextForStorage } = require('../../runtime/log_sanitize');

function clampInt(x, min, max) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

class EventLogRepo {
  constructor({ pool }) {
    this._pool = pool;
  }

  async appendEvent({
    traceId,
    chatId = null,
    tgUpdateId = null,
    tgMessageId = null,
    component,
    event,
    level = 'info',
    durationMs = null,
    payload = null,
  }) {
    const safeTraceId = String(traceId || '').trim();
    if (!safeTraceId) throw new Error('traceId is required');
    const safeComponent = String(component || '').trim();
    const safeEvent = String(event || '').trim();
    const safeLevel = String(level || 'info').trim();
    if (!safeComponent) throw new Error('component is required');
    if (!safeEvent) throw new Error('event is required');

    const safeChatId = chatId === null || chatId === undefined ? null : Number(chatId);
    const safeUpdateId = tgUpdateId === null || tgUpdateId === undefined ? null : Number(tgUpdateId);
    const safeMsgId = tgMessageId === null || tgMessageId === undefined ? null : Number(tgMessageId);
    const safeDuration = durationMs === null || durationMs === undefined ? null : clampInt(durationMs, 0, 3600_000);

    const sanitizedPayload = payload === null || payload === undefined ? null : sanitizeForEventLog(payload);
    const payloadJson = sanitizedPayload === null ? null : safeJsonStringify(sanitizedPayload);
    const payloadJsonBounded = payloadJson === null ? null : sanitizeTextForStorage(payloadJson);

    await this._pool.query(
      `
      INSERT INTO event_log (trace_id, chat_id, tg_update_id, tg_message_id, component, event, level, duration_ms, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `,
      [safeTraceId, Number.isFinite(safeChatId) ? safeChatId : null, Number.isFinite(safeUpdateId) ? safeUpdateId : null, Number.isFinite(safeMsgId) ? safeMsgId : null, safeComponent, safeEvent, safeLevel, safeDuration, payloadJsonBounded]
    );
  }

  async purgeOld({ ttlDays = 90 }) {
    const days = clampInt(ttlDays, 1, 3650) || 90;
    await this._pool.query(`DELETE FROM event_log WHERE ts < NOW() - ($1::int * INTERVAL '1 day')`, [days]);
  }

  async listByChat({ chatId, limit = 200, sinceIso = null }) {
    const safeChatId = Number(chatId);
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    const lim = clampInt(limit, 1, 2000) || 200;
    const since = sinceIso ? new Date(String(sinceIso)) : null;
    const hasSince = since && Number.isFinite(since.getTime());
    const res = await this._pool.query(
      `
      SELECT id, ts, trace_id, chat_id, tg_update_id, tg_message_id, component, event, level, duration_ms, payload
      FROM event_log
      WHERE chat_id = $1
        AND ($2::timestamptz IS NULL OR ts >= $2::timestamptz)
      ORDER BY ts DESC
      LIMIT $3
      `,
      [safeChatId, hasSince ? since.toISOString() : null, lim]
    );
    return res.rows || [];
  }
}

module.exports = { EventLogRepo };


