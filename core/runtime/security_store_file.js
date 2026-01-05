const fs = require('fs');
const path = require('path');

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath, data) {
  ensureDirForFile(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeChatTitle(chat) {
  const t = chat?.title || chat?.username || chat?.first_name || null;
  return t ? String(t) : null;
}

class FileSecurityStore {
  constructor({ filePath }) {
    this._filePath = String(filePath);
  }

  _load() {
    const data = safeReadJson(this._filePath);
    if (data && typeof data === 'object') return data;
    return { chats: {}, audit: [] };
  }

  _save(data) {
    atomicWriteJson(this._filePath, data);
  }

  async upsertChatSeen({ chatId, chatType, chatTitle, fromUserId, fromUsername }) {
    const data = this._load();
    const key = String(chatId);
    const existing = data.chats[key] || null;
    const inserted = !existing;

    const firstSeenAt = existing?.first_seen_at || nowIso();
    const lastSeenAt = nowIso();

    const next = {
      chat_id: Number(chatId),
      first_seen_at: firstSeenAt,
      last_seen_at: lastSeenAt,
      chat_type: chatType ? String(chatType) : (existing?.chat_type || null),
      chat_title: chatTitle ? String(chatTitle) : (existing?.chat_title || null),
      last_from_user_id: fromUserId !== undefined && fromUserId !== null ? Number(fromUserId) : (existing?.last_from_user_id || null),
      last_from_username: fromUsername ? String(fromUsername) : (existing?.last_from_username || null),
      revoked: Boolean(existing?.revoked || false),
      revoked_at: existing?.revoked_at || null,
      revoked_by_chat_id: existing?.revoked_by_chat_id || null,
      revoked_reason: existing?.revoked_reason || null,
      allowlisted: Boolean(existing?.allowlisted || false),
      allowlisted_at: existing?.allowlisted_at || null,
      allowlisted_by_chat_id: existing?.allowlisted_by_chat_id || null,
    };

    data.chats[key] = next;
    this._save(data);
    return { inserted, chatId: Number(chatId), revoked: Boolean(next.revoked), allowlisted: Boolean(next.allowlisted) };
  }

  async getChat({ chatId }) {
    const data = this._load();
    return data.chats[String(chatId)] || null;
  }

  async listChats({ limit = 20 } = {}) {
    const data = this._load();
    const lim = Math.min(Math.max(1, Number(limit) || 20), 200);
    const rows = Object.values(data.chats || {});
    rows.sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')));
    return rows.slice(0, lim);
  }

  async setRevoked({ chatId, revoked, actorChatId, reason }) {
    const data = this._load();
    const key = String(chatId);
    const existing = data.chats[key] || null;
    if (!existing) {
      data.chats[key] = {
        chat_id: Number(chatId),
        first_seen_at: nowIso(),
        last_seen_at: nowIso(),
        chat_type: null,
        chat_title: null,
        last_from_user_id: null,
        last_from_username: null,
        revoked: Boolean(revoked),
        revoked_at: revoked ? nowIso() : null,
        revoked_by_chat_id: revoked ? Number(actorChatId) : null,
        revoked_reason: revoked ? String(reason || '') : null,
        allowlisted: false,
        allowlisted_at: null,
        allowlisted_by_chat_id: null,
      };
    } else {
      existing.revoked = Boolean(revoked);
      existing.revoked_at = revoked ? nowIso() : null;
      existing.revoked_by_chat_id = revoked ? Number(actorChatId) : null;
      existing.revoked_reason = revoked ? String(reason || '') : null;
      existing.last_seen_at = nowIso();
      data.chats[key] = existing;
    }

    const auditEntry = {
      ts: nowIso(),
      actor_chat_id: actorChatId !== undefined && actorChatId !== null ? Number(actorChatId) : null,
      action: revoked ? 'revoke' : 'unrevoke',
      target_chat_id: Number(chatId),
      details: reason ? { reason: String(reason) } : null,
    };
    data.audit = Array.isArray(data.audit) ? data.audit : [];
    data.audit.unshift(auditEntry);
    data.audit = data.audit.slice(0, 200);

    this._save(data);
  }

  async appendAudit({ actorChatId, action, targetChatId, details }) {
    const data = this._load();
    const auditEntry = {
      ts: nowIso(),
      actor_chat_id: actorChatId !== undefined && actorChatId !== null ? Number(actorChatId) : null,
      action: String(action),
      target_chat_id: targetChatId !== undefined && targetChatId !== null ? Number(targetChatId) : null,
      details: details || null,
    };
    data.audit = Array.isArray(data.audit) ? data.audit : [];
    data.audit.unshift(auditEntry);
    data.audit = data.audit.slice(0, 200);
    this._save(data);
  }
}

module.exports = {
  FileSecurityStore,
  normalizeChatTitle,
};







