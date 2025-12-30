class PreferencesRepo {
  constructor({ pool }) {
    this._pool = pool;
  }

  _makeExternalId({ chatId, scope, key }) {
    const safeChat = Number(chatId);
    const safeScope = String(scope || 'global').trim() || 'global';
    const safeKey = String(key || '').trim();
    return `pref:${safeChat}:${safeScope}:${safeKey}`;
  }

  makeExternalId({ chatId, scope = 'global', key }) {
    return this._makeExternalId({ chatId, scope, key });
  }

  async upsertPreference({
    chatId,
    scope = 'global',
    category = null,
    key,
    valueJson = {},
    valueHuman = null,
    active = true,
    source = 'postgres',
  }) {
    const safeChatId = Number(chatId);
    const safeScope = String(scope || 'global').trim() || 'global';
    const safeKey = String(key || '').trim();
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    if (!safeKey) throw new Error('key is required');

    const safeCategory = category === undefined ? null : category === null ? null : String(category || '').trim() || null;
    const safeValueHuman =
      valueHuman === undefined ? null : valueHuman === null ? null : String(valueHuman || '').trim() || null;
    const safeActive = Boolean(active);
    const safeSource = String(source || 'postgres').trim() || 'postgres';

    const json =
      valueJson && typeof valueJson === 'object' && !Array.isArray(valueJson)
        ? valueJson
        : { value: valueJson === undefined ? null : valueJson };

    const res = await this._pool.query(
      `
      INSERT INTO preferences (chat_id, scope, category, pref_key, value_json, value_human, active, source, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (chat_id, scope, pref_key)
      DO UPDATE SET
        category = EXCLUDED.category,
        value_json = EXCLUDED.value_json,
        value_human = EXCLUDED.value_human,
        active = EXCLUDED.active,
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING id, chat_id, scope, category, pref_key, value_json, value_human, active, source, created_at, updated_at
      `,
      [safeChatId, safeScope, safeCategory, safeKey, JSON.stringify(json), safeValueHuman, safeActive, safeSource]
    );

    const row = res.rows && res.rows[0] ? res.rows[0] : null;
    const externalId = this._makeExternalId({ chatId: safeChatId, scope: safeScope, key: safeKey });
    return { externalId, row };
  }

  async setPreferenceActive({ chatId, scope = 'global', key, active }) {
    const safeChatId = Number(chatId);
    const safeScope = String(scope || 'global').trim() || 'global';
    const safeKey = String(key || '').trim();
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    if (!safeKey) throw new Error('key is required');

    await this._pool.query(
      `UPDATE preferences SET active = $4, updated_at = NOW() WHERE chat_id = $1 AND scope = $2 AND pref_key = $3`,
      [safeChatId, safeScope, safeKey, Boolean(active)]
    );
  }

  async listPreferencesForChat({ chatId, activeOnly = true } = {}) {
    const safeChatId = Number(chatId);
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');

    const where = ['chat_id = $1'];
    const args = [safeChatId];
    if (activeOnly) where.push('active = TRUE');

    const res = await this._pool.query(
      `
      SELECT id, chat_id, scope, category, pref_key, value_json, value_human, active, source, created_at, updated_at
      FROM preferences
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC
      `,
      args
    );
    return res.rows || [];
  }

  async upsertSyncRow({
    externalId,
    chatId,
    scope = 'global',
    key,
    notionPageId = null,
    lastPushedHash = null,
    lastPushedAt = null,
    lastSeenNotionEditedAt = null,
  }) {
    const safeExternalId = String(externalId || '').trim();
    const safeChatId = Number(chatId);
    const safeScope = String(scope || 'global').trim() || 'global';
    const safeKey = String(key || '').trim();
    if (!safeExternalId) throw new Error('externalId is required');
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');
    if (!safeKey) throw new Error('key is required');

    await this._pool.query(
      `
      INSERT INTO preferences_sync (
        external_id, chat_id, scope, pref_key,
        notion_page_id, last_pushed_hash, last_pushed_at, last_seen_notion_edited_at,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      ON CONFLICT (external_id)
      DO UPDATE SET
        chat_id = EXCLUDED.chat_id,
        scope = EXCLUDED.scope,
        pref_key = EXCLUDED.pref_key,
        notion_page_id = COALESCE(EXCLUDED.notion_page_id, preferences_sync.notion_page_id),
        last_pushed_hash = COALESCE(EXCLUDED.last_pushed_hash, preferences_sync.last_pushed_hash),
        last_pushed_at = COALESCE(EXCLUDED.last_pushed_at, preferences_sync.last_pushed_at),
        last_seen_notion_edited_at = COALESCE(EXCLUDED.last_seen_notion_edited_at, preferences_sync.last_seen_notion_edited_at),
        updated_at = NOW()
      `,
      [
        safeExternalId,
        safeChatId,
        safeScope,
        safeKey,
        notionPageId ? String(notionPageId) : null,
        lastPushedHash ? String(lastPushedHash) : null,
        lastPushedAt || null,
        lastSeenNotionEditedAt || null,
      ]
    );
  }

  async getSyncRowByExternalId({ externalId }) {
    const safeExternalId = String(externalId || '').trim();
    if (!safeExternalId) return null;
    const res = await this._pool.query(`SELECT * FROM preferences_sync WHERE external_id = $1`, [safeExternalId]);
    return res.rows && res.rows[0] ? res.rows[0] : null;
  }

  async getMaxLastSeenNotionEditedAt({ overlapSeconds = 120 } = {}) {
    const safeOverlapSeconds = Math.min(Math.max(0, Number(overlapSeconds) || 0), 24 * 3600);
    const res = await this._pool.query(
      `SELECT MAX(last_seen_notion_edited_at) AS max_seen FROM preferences_sync`
    );
    const maxSeen = res.rows && res.rows[0] ? res.rows[0].max_seen : null;
    const dt = maxSeen ? new Date(maxSeen) : new Date(0);
    const adjusted = new Date(dt.getTime() - safeOverlapSeconds * 1000);
    return adjusted.toISOString();
  }

  async enqueueNotionSync({ kind, externalId, payload, payloadHash = null }) {
    const safeKind = String(kind || '').trim();
    const safeExternalId = String(externalId || '').trim();
    if (!safeKind) throw new Error('kind is required');
    if (!safeExternalId) throw new Error('externalId is required');

    const safePayload = payload && typeof payload === 'object' ? payload : { value: payload };
    const safeHash = payloadHash ? String(payloadHash) : null;

    await this._pool.query(
      `
      INSERT INTO notion_sync_queue (kind, external_id, payload, payload_hash, attempt, next_run_at, last_error, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, 0, NOW(), NULL, NOW(), NOW())
      ON CONFLICT (kind, external_id)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        payload_hash = EXCLUDED.payload_hash,
        attempt = 0,
        next_run_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      `,
      [safeKind, safeExternalId, JSON.stringify(safePayload), safeHash]
    );
  }

  async claimQueueBatch({ limit = 20, leaseSeconds = 300 } = {}) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
    const safeLeaseSeconds = Math.min(Math.max(10, Number(leaseSeconds) || 300), 3600);

    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `
        SELECT id, kind, external_id, payload, payload_hash, attempt, next_run_at
        FROM notion_sync_queue
        WHERE next_run_at <= NOW()
        ORDER BY next_run_at ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
        `,
        [safeLimit]
      );

      const rows = res.rows || [];
      if (rows.length) {
        const ids = rows.map((r) => Number(r.id));
        await client.query(
          `
          UPDATE notion_sync_queue
          SET next_run_at = NOW() + ($2 || ' seconds')::interval, updated_at = NOW()
          WHERE id = ANY($1::bigint[])
          `,
          [ids, String(safeLeaseSeconds)]
        );
      }

      await client.query('COMMIT');
      return rows;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteQueueItem({ id }) {
    await this._pool.query(`DELETE FROM notion_sync_queue WHERE id = $1`, [Number(id)]);
  }

  async rescheduleQueueItem({ id, error = null, delaySeconds = 60, incrementAttempt = true }) {
    const safeDelaySeconds = Math.min(Math.max(10, Number(delaySeconds) || 60), 24 * 3600);
    const safeError = error ? String(error).slice(0, 2000) : null;
    await this._pool.query(
      `
      UPDATE notion_sync_queue
      SET
        attempt = attempt + $2,
        next_run_at = NOW() + ($3 || ' seconds')::interval,
        last_error = $4,
        updated_at = NOW()
      WHERE id = $1
      `,
      [Number(id), incrementAttempt ? 1 : 0, String(safeDelaySeconds), safeError]
    );
  }
}

module.exports = { PreferencesRepo };


