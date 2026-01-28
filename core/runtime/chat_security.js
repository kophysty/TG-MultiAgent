const { ChatSecurityRepo } = require('../connectors/postgres/chat_security_repo');
const { FileSecurityStore, normalizeChatTitle } = require('./security_store_file');

function parseAdminChatIds() {
  const raw = String(process.env.TG_ADMIN_CHAT_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

function parseAllowlistMode() {
  // off | warn | enforce
  const raw = String(process.env.TG_SECURITY_ALLOWLIST_MODE || '').trim().toLowerCase();
  if (!raw) return 'off';
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return 'off';
  if (raw === 'warn') return 'warn';
  if (raw === 'enforce') return 'enforce';
  return 'off';
}

function pickStoreKind({ pgPool }) {
  const want = String(process.env.TG_SECURITY_STORE || 'auto').trim().toLowerCase();
  if (want === 'pg' || want === 'postgres') return pgPool ? 'pg' : 'file';
  if (want === 'file') return 'file';
  return pgPool ? 'pg' : 'file';
}

function getDefaultFilePath() {
  return String(process.env.TG_SECURITY_FILE_PATH || 'data/security/sessions.json');
}

function nowHuman() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatChatLine(row) {
  const id = row.chat_id ?? row.chatId ?? row.chat_id;
  const revoked = Boolean(row.revoked);
  const allowlisted = Boolean(row.allowlisted);
  const lastSeen = row.last_seen_at || row.lastSeenAt || row.last_seen_at || null;
  const title = row.chat_title || row.chatTitle || null;
  const uname = row.last_from_username || row.lastFromUsername || null;
  const markers = [];
  if (revoked) markers.push('[REVOKED]');
  if (allowlisted) markers.push('[ALLOWED]');
  const marker = markers.join('');
  return `${marker} chatId=${id} last_seen=${lastSeen || '?'} title=${title || '-'} user=${uname || '-'}`.trim();
}

function createChatSecurity({ bot, pgPool }) {
  const adminChatIds = parseAdminChatIds();
  const allowlistMode = parseAllowlistMode();
  const kind = pickStoreKind({ pgPool });
  const store =
    kind === 'pg'
      ? new ChatSecurityRepo({ pool: pgPool })
      : new FileSecurityStore({ filePath: getDefaultFilePath() });

  const blockedReplyTsByChatId = new Map();

  function isAdminChat(chatId) {
    const id = Number(chatId);
    return adminChatIds.includes(id);
  }

  async function notifyAdmins(text) {
    if (!adminChatIds.length) return;
    for (const adminId of adminChatIds) {
      try {
        await bot.sendMessage(adminId, text);
      } catch {
        // ignore notify failures
      }
    }
  }

  async function touchFromMsg(msg) {
    const chatId = msg?.chat?.id;
    if (!chatId) return { ok: false, inserted: false, revoked: false };

    const chatType = msg?.chat?.type || null;
    const chatTitle = normalizeChatTitle(msg?.chat);
    const fromUserId = msg?.from?.id ?? null;
    const fromUsername = msg?.from?.username ?? null;

    const res = await store.upsertChatSeen({ chatId, chatType, chatTitle, fromUserId, fromUsername });
    if (res.inserted) {
      const human = nowHuman();
      await notifyAdmins(
        [
          'Новый чат для бота:',
          `- time: ${human}`,
          `- chatId: ${chatId}`,
          `- type: ${chatType || '-'}`,
          `- title: ${chatTitle || '-'}`,
          `- from: ${fromUsername || '-'} (${fromUserId || '-'})`,
          `- allowlisted: ${res.allowlisted ? 'true' : 'false'}`,
          `- allowlist_mode: ${allowlistMode}`,
        ].join('\n')
      );
      await store.appendAudit({
        actorChatId: null,
        action: 'new_chat',
        targetChatId: chatId,
        details: { chatType, chatTitle, fromUserId, fromUsername },
      });
    }
    return { ok: true, inserted: Boolean(res.inserted), revoked: Boolean(res.revoked) };
  }

  async function touchFromCallback(query) {
    const msg = query?.message || null;
    if (!msg) return { ok: false, inserted: false, revoked: false };
    return await touchFromMsg(msg);
  }

  async function isRevoked(chatId) {
    const row = await store.getChat({ chatId });
    return Boolean(row?.revoked);
  }

  async function isAllowlisted(chatId) {
    const row = await store.getChat({ chatId });
    return Boolean(row?.allowlisted);
  }

  async function getBlockReason(chatId) {
    if (isAdminChat(chatId)) return null;
    const row = await store.getChat({ chatId });
    if (row?.revoked) return 'revoked';
    if (allowlistMode === 'enforce') {
      if (row?.allowlisted) return null;
      return 'not_allowed';
    }
    return null;
  }

  async function shouldBlockChat(chatId) {
    return Boolean(await getBlockReason(chatId));
  }

  async function maybeReplyBlocked(chatId, reason) {
    const now = Date.now();
    const last = blockedReplyTsByChatId.get(chatId) || 0;
    if (now - last < 5 * 60 * 1000) return;
    blockedReplyTsByChatId.set(chatId, now);
    try {
      if (reason === 'revoked') {
        await bot.sendMessage(chatId, 'Этот чат отключен администратором. Если это ошибка, попроси админа сделать /unrevoke.');
        return;
      }
      if (reason === 'not_allowed') {
        await bot.sendMessage(chatId, 'Бот находится в разработке.');
        return;
      }
    } catch {}
  }

  async function listSessions({ limit }) {
    const rows = await store.listChats({ limit });
    return rows;
  }

  async function revokeChat({ actorChatId, targetChatId, reason }) {
    await store.setRevoked({ chatId: targetChatId, revoked: true, actorChatId, reason: reason || null });
    await notifyAdmins(`Revoke: chatId=${targetChatId} by adminChatId=${actorChatId}${reason ? `\nПричина: ${reason}` : ''}`);
  }

  async function unrevokeChat({ actorChatId, targetChatId }) {
    await store.setRevoked({ chatId: targetChatId, revoked: false, actorChatId, reason: null });
    await notifyAdmins(`Unrevoke: chatId=${targetChatId} by adminChatId=${actorChatId}`);
  }

  async function allowChat({ actorChatId, targetChatId }) {
    if (typeof store.setAllowlisted !== 'function') throw new Error('setAllowlisted not supported by store');
    await store.setAllowlisted({ chatId: targetChatId, allowlisted: true, actorChatId });
    await notifyAdmins(`Allowlist: chatId=${targetChatId} by adminChatId=${actorChatId}`);
  }

  async function unallowChat({ actorChatId, targetChatId }) {
    if (typeof store.setAllowlisted !== 'function') throw new Error('setAllowlisted not supported by store');
    await store.setAllowlisted({ chatId: targetChatId, allowlisted: false, actorChatId });
    await notifyAdmins(`Unallowlist: chatId=${targetChatId} by adminChatId=${actorChatId}`);
  }

  function backendName() {
    return kind;
  }

  return {
    adminChatIds,
    isAdminChat,
    allowlistMode,
    backendName,
    touchFromMsg,
    touchFromCallback,
    getBlockReason,
    shouldBlockChat,
    maybeReplyBlocked,
    listSessions,
    revokeChat,
    unrevokeChat,
    allowChat,
    unallowChat,
  };
}

module.exports = { createChatSecurity, formatChatLine };








