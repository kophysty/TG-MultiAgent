class ChatSecurityRepo {
  constructor({ pool }) {
    this._pool = pool;
  }

  async upsertChatSeen({ chatId, chatType, chatTitle, fromUserId, fromUsername }) {
    const res = await this._pool.query(
      `
      INSERT INTO chat_security_chats (
        chat_id,
        first_seen_at,
        last_seen_at,
        chat_type,
        chat_title,
        last_from_user_id,
        last_from_username
      )
      VALUES ($1, NOW(), NOW(), $2, $3, $4, $5)
      ON CONFLICT (chat_id)
      DO UPDATE SET
        last_seen_at = NOW(),
        chat_type = EXCLUDED.chat_type,
        chat_title = EXCLUDED.chat_title,
        last_from_user_id = EXCLUDED.last_from_user_id,
        last_from_username = EXCLUDED.last_from_username
      RETURNING chat_id, revoked, allowlisted, (xmax = 0) AS inserted
      `,
      [
        Number(chatId),
        chatType ? String(chatType) : null,
        chatTitle ? String(chatTitle) : null,
        fromUserId !== null && fromUserId !== undefined ? Number(fromUserId) : null,
        fromUsername ? String(fromUsername) : null,
      ]
    );
    const row = res.rows?.[0] || null;
    return {
      inserted: Boolean(row?.inserted),
      chatId: Number(row?.chat_id || chatId),
      revoked: Boolean(row?.revoked),
      allowlisted: Boolean(row?.allowlisted),
    };
  }

  async getChat({ chatId }) {
    const res = await this._pool.query(
      `SELECT * FROM chat_security_chats WHERE chat_id = $1`,
      [Number(chatId)]
    );
    return res.rows?.[0] || null;
  }

  async listChats({ limit = 20 } = {}) {
    const lim = Math.min(Math.max(1, Number(limit) || 20), 200);
    const res = await this._pool.query(
      `
      SELECT chat_id, first_seen_at, last_seen_at, chat_type, chat_title, last_from_user_id, last_from_username,
             revoked, revoked_at, revoked_by_chat_id, revoked_reason, allowlisted
      FROM chat_security_chats
      ORDER BY last_seen_at DESC
      LIMIT $1
      `,
      [lim]
    );
    return res.rows || [];
  }

  async setRevoked({ chatId, revoked, actorChatId, reason }) {
    const cid = Number(chatId);
    const isRevoked = Boolean(revoked);
    const actor = actorChatId !== undefined && actorChatId !== null ? Number(actorChatId) : null;
    const reasonText = reason ? String(reason) : null;

    // Upsert so revoke works even if the chat row was not created yet.
    await this._pool.query(
      `
      INSERT INTO chat_security_chats (
        chat_id,
        first_seen_at,
        last_seen_at,
        revoked,
        revoked_at,
        revoked_by_chat_id,
        revoked_reason
      )
      VALUES (
        $1,
        NOW(),
        NOW(),
        $2,
        CASE WHEN $2 = TRUE THEN NOW() ELSE NULL END,
        CASE WHEN $2 = TRUE THEN $3 ELSE NULL END,
        CASE WHEN $2 = TRUE THEN $4 ELSE NULL END
      )
      ON CONFLICT (chat_id)
      DO UPDATE SET
        revoked = EXCLUDED.revoked,
        revoked_at = EXCLUDED.revoked_at,
        revoked_by_chat_id = EXCLUDED.revoked_by_chat_id,
        revoked_reason = EXCLUDED.revoked_reason,
        last_seen_at = NOW()
      `,
      [cid, isRevoked, actor, reasonText]
    );
    await this.appendAudit({
      actorChatId,
      action: revoked ? 'revoke' : 'unrevoke',
      targetChatId: chatId,
      details: reason ? { reason: String(reason) } : null,
    });
  }

  async setAllowlisted({ chatId, allowlisted, actorChatId }) {
    const cid = Number(chatId);
    const isAllowlisted = Boolean(allowlisted);
    const actor = actorChatId !== undefined && actorChatId !== null ? Number(actorChatId) : null;

    await this._pool.query(
      `
      INSERT INTO chat_security_chats (
        chat_id,
        first_seen_at,
        last_seen_at,
        allowlisted,
        allowlisted_at,
        allowlisted_by_chat_id
      )
      VALUES (
        $1,
        NOW(),
        NOW(),
        $2,
        CASE WHEN $2 = TRUE THEN NOW() ELSE NULL END,
        CASE WHEN $2 = TRUE THEN $3 ELSE NULL END
      )
      ON CONFLICT (chat_id)
      DO UPDATE SET
        allowlisted = EXCLUDED.allowlisted,
        allowlisted_at = EXCLUDED.allowlisted_at,
        allowlisted_by_chat_id = EXCLUDED.allowlisted_by_chat_id,
        last_seen_at = NOW()
      `,
      [cid, isAllowlisted, actor]
    );

    await this.appendAudit({
      actorChatId,
      action: isAllowlisted ? 'allowlist' : 'unallowlist',
      targetChatId: chatId,
      details: null,
    });
  }

  async appendAudit({ actorChatId, action, targetChatId, details }) {
    await this._pool.query(
      `
      INSERT INTO chat_security_audit (ts, actor_chat_id, action, target_chat_id, details)
      VALUES (NOW(), $1, $2, $3, $4)
      `,
      [
        actorChatId !== undefined && actorChatId !== null ? Number(actorChatId) : null,
        String(action),
        targetChatId !== undefined && targetChatId !== null ? Number(targetChatId) : null,
        details ? JSON.stringify(details) : null,
      ]
    );
  }
}

module.exports = { ChatSecurityRepo };








