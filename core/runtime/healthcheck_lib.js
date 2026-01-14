const axios = require('axios');

const { createPgPoolFromEnv } = require('../connectors/postgres/client');
const { NotionTasksRepo } = require('../connectors/notion/tasks_repo');
const { NotionIdeasRepo } = require('../connectors/notion/ideas_repo');
const { NotionSocialRepo } = require('../connectors/notion/social_repo');
const { NotionJournalRepo } = require('../connectors/notion/journal_repo');
const { sanitizeErrorForLog } = require('./log_sanitize');

function tailId(id, n = 6) {
  const s = String(id || '').trim();
  if (!s) return null;
  const k = Math.max(3, Math.min(16, Math.trunc(Number(n) || 6)));
  if (s.length <= k) return s;
  return s.slice(-k);
}

function parseAdminChatIdsFromEnv() {
  const raw = String(process.env.TG_ADMIN_CHAT_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

function pickTelegramTokenFromEnv() {
  const mode = String(process.env.TG_BOT_MODE || 'tests').trim().toLowerCase();
  if (mode === 'prod') return process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN || null;
  return process.env.TELEGRAM_BOT_TOKEN_TESTS || process.env.TELEGRAM_BOT_TOKEN || null;
}

async function checkPostgres() {
  const pool = createPgPoolFromEnv();
  if (!pool) return { ok: false, items: [{ name: 'POSTGRES_URL', ok: false, info: 'missing' }] };

  const items = [];
  try {
    await pool.query('select 1 as ok');
    items.push({ name: 'connect', ok: true });
  } catch (e) {
    items.push({ name: 'connect', ok: false, info: sanitizeErrorForLog(e) });
    return { ok: false, items };
  }

  const tables = [
    'preferences',
    'preferences_sync',
    'notion_sync_queue',
    'chat_messages',
    'chat_summaries',
    'memory_suggestions',
    'work_context_cache',
    'event_log',
  ];

  for (const t of tables) {
    try {
      const res = await pool.query(`select to_regclass($1) as reg`, [`public.${t}`]);
      const reg = res.rows?.[0]?.reg || null;
      items.push({ name: `table:${t}`, ok: Boolean(reg), info: reg ? 'ok' : 'missing' });
    } catch (e) {
      items.push({ name: `table:${t}`, ok: false, info: sanitizeErrorForLog(e) });
    }
  }

  try {
    await pool.end();
  } catch {
    // ignore
  }

  return { ok: items.every((x) => x.ok), items };
}

async function checkNotion() {
  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_TOKEN_LOCAL;
  if (!notionToken) return { ok: false, items: [{ name: 'NOTION_TOKEN', ok: false, info: 'missing' }] };

  const tasksDbId = process.env.NOTION_TASKS_DB_ID || process.env.NOTION_DATABASE_ID || process.env.NOTION_DATABASE_ID_LOCAL || null;
  const ideasDbId = process.env.NOTION_IDEAS_DB_ID || null;
  const socialDbId = process.env.NOTION_SOCIAL_DB_ID || null;
  const journalDbId = process.env.NOTION_JOURNAL_DB_ID || null;
  const tasksTestDbId = process.env.NOTION_TASKS_TEST_DB_ID || null;

  const items = [];

  async function probe(name, fn, idForHint = null) {
    try {
      const db = await fn();
      const title = Array.isArray(db?.title) && db.title[0]?.plain_text ? db.title[0].plain_text : null;
      const tail = idForHint ? tailId(idForHint, 6) : null;
      const info = tail ? `${title || 'ok'} (...${tail})` : title || 'ok';
      items.push({ name, ok: true, info });
    } catch (e) {
      items.push({ name, ok: false, info: sanitizeErrorForLog(e) });
    }
  }

  if (tasksDbId) {
    const repo = new NotionTasksRepo({ notionToken, databaseId: tasksDbId });
    await probe('notion:tasks_db', () => repo.getDatabase(), tasksDbId);
  } else {
    items.push({ name: 'notion:tasks_db', ok: false, info: 'NOTION_TASKS_DB_ID missing' });
  }

  if (ideasDbId) {
    const repo = new NotionIdeasRepo({ notionToken, databaseId: ideasDbId });
    await probe('notion:ideas_db', () => repo.getDatabase(), ideasDbId);
  } else {
    items.push({ name: 'notion:ideas_db', ok: false, info: 'NOTION_IDEAS_DB_ID missing' });
  }

  if (socialDbId) {
    const repo = new NotionSocialRepo({ notionToken, databaseId: socialDbId });
    await probe('notion:social_db', () => repo.getDatabase(), socialDbId);
  } else {
    items.push({ name: 'notion:social_db', ok: false, info: 'NOTION_SOCIAL_DB_ID missing' });
  }

  if (journalDbId) {
    const repo = new NotionJournalRepo({ notionToken, databaseId: journalDbId });
    await probe('notion:journal_db', () => repo.getDatabase(), journalDbId);
  } else {
    items.push({ name: 'notion:journal_db', ok: false, info: 'NOTION_JOURNAL_DB_ID missing' });
  }

  if (tasksTestDbId) {
    const repo = new NotionTasksRepo({ notionToken, databaseId: tasksTestDbId });
    await probe('notion:tasks_test_db', () => repo.getDatabase(), tasksTestDbId);
  }

  const prefsDbId = process.env.NOTION_PREFERENCES_DB_ID || null;
  if (!prefsDbId) {
    items.push({ name: 'notion:preferences_db', ok: false, info: 'NOTION_PREFERENCES_DB_ID missing' });
  } else {
    await probe(
      'notion:preferences_db',
      async () => {
        const resp = await axios.get(`https://api.notion.com/v1/databases/${prefsDbId}`, {
          headers: {
            Authorization: `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
          },
          timeout: 30_000,
        });
        return resp.data;
      },
      prefsDbId
    );
  }

  return { ok: items.every((x) => x.ok), items };
}

async function checkTelegramSend() {
  const token = pickTelegramTokenFromEnv();
  if (!token) return { ok: false, items: [{ name: 'TELEGRAM_BOT_TOKEN', ok: false, info: 'missing' }] };

  const ids = parseAdminChatIdsFromEnv();
  const chatId = Number(process.env.TG_HEALTHCHECK_CHAT_ID || '') || (ids.length ? ids[0] : null);
  if (!Number.isFinite(chatId)) return { ok: false, items: [{ name: 'TG_ADMIN_CHAT_IDS', ok: false, info: 'missing chat id' }] };

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text: `Healthcheck ok. ${new Date().toISOString()}` },
      { timeout: 30_000 }
    );
    return { ok: true, items: [{ name: 'telegram:send', ok: true, info: `chatId=${chatId}` }] };
  } catch (e) {
    return { ok: false, items: [{ name: 'telegram:send', ok: false, info: sanitizeErrorForLog(e) }] };
  }
}

async function runHealthcheck({ wantPostgres = true, wantNotion = true, wantTelegram = false } = {}) {
  let ok = true;
  const report = { ok: true, ts: new Date().toISOString(), sections: {} };

  if (wantPostgres) {
    const res = await checkPostgres();
    report.sections.postgres = res;
    ok = ok && res.ok;
  }
  if (wantNotion) {
    const res = await checkNotion();
    report.sections.notion = res;
    ok = ok && res.ok;
  }
  if (wantTelegram) {
    const res = await checkTelegramSend();
    report.sections.telegram = res;
    ok = ok && res.ok;
  }

  report.ok = ok;
  return report;
}

module.exports = { runHealthcheck, checkPostgres, checkNotion, checkTelegramSend, tailId };

