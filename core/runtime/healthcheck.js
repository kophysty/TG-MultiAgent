const axios = require('axios');

const { hydrateProcessEnv } = require('./env');
const { createPgPoolFromEnv } = require('../connectors/postgres/client');
const { NotionTasksRepo } = require('../connectors/notion/tasks_repo');
const { NotionIdeasRepo } = require('../connectors/notion/ideas_repo');
const { NotionSocialRepo } = require('../connectors/notion/social_repo');
const { NotionJournalRepo } = require('../connectors/notion/journal_repo');
const { sanitizeErrorForLog } = require('./log_sanitize');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const wantTelegram = args.has('--telegram');
  const wantNotion = args.has('--notion') || (!args.has('--postgres') && !args.has('--telegram'));
  const wantPostgres = args.has('--postgres') || (!args.has('--notion') && !args.has('--telegram'));
  return { wantTelegram, wantNotion, wantPostgres };
}

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

function pickTelegramToken() {
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

  const items = [];

  async function probe(name, fn) {
    try {
      const db = await fn();
      const title = Array.isArray(db?.title) && db.title[0]?.plain_text ? db.title[0].plain_text : null;
      items.push({ name, ok: true, info: title || 'ok' });
    } catch (e) {
      items.push({ name, ok: false, info: sanitizeErrorForLog(e) });
    }
  }

  if (tasksDbId) {
    const repo = new NotionTasksRepo({ notionToken, databaseId: tasksDbId });
    await probe('notion:tasks_db', () => repo.getDatabase());
  } else {
    items.push({ name: 'notion:tasks_db', ok: false, info: 'NOTION_TASKS_DB_ID missing' });
  }

  if (ideasDbId) {
    const repo = new NotionIdeasRepo({ notionToken, databaseId: ideasDbId });
    await probe('notion:ideas_db', () => repo.getDatabase());
  } else {
    items.push({ name: 'notion:ideas_db', ok: false, info: 'NOTION_IDEAS_DB_ID missing' });
  }

  if (socialDbId) {
    const repo = new NotionSocialRepo({ notionToken, databaseId: socialDbId });
    await probe('notion:social_db', () => repo.getDatabase());
  } else {
    items.push({ name: 'notion:social_db', ok: false, info: 'NOTION_SOCIAL_DB_ID missing' });
  }

  if (journalDbId) {
    const repo = new NotionJournalRepo({ notionToken, databaseId: journalDbId });
    await probe('notion:journal_db', () => repo.getDatabase());
  } else {
    items.push({ name: 'notion:journal_db', ok: false, info: 'NOTION_JOURNAL_DB_ID missing' });
  }

  const prefsDbId = process.env.NOTION_PREFERENCES_DB_ID || null;
  if (!prefsDbId) {
    items.push({ name: 'notion:preferences_db', ok: false, info: 'NOTION_PREFERENCES_DB_ID missing' });
  } else {
    // Use raw Notion API via axios to avoid coupling to NotionPreferencesRepo constructor details.
    await probe('notion:preferences_db', async () => {
      const resp = await axios.get(`https://api.notion.com/v1/databases/${prefsDbId}`, {
        headers: {
          Authorization: `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28',
        },
        timeout: 30_000,
      });
      return resp.data;
    });
  }

  return { ok: items.every((x) => x.ok), items };
}

async function checkTelegram() {
  const token = pickTelegramToken();
  if (!token) return { ok: false, items: [{ name: 'TELEGRAM_BOT_TOKEN', ok: false, info: 'missing' }] };

  const ids = parseAdminChatIds();
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

function printSection(title, res) {
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
  for (const it of res.items || []) {
    const status = it.ok ? 'ok' : 'fail';
    // eslint-disable-next-line no-console
    console.log(`- ${status} ${it.name}${it.info ? `: ${typeof it.info === 'string' ? it.info : JSON.stringify(it.info)}` : ''}`);
  }
}

async function main() {
  hydrateProcessEnv();
  const { wantTelegram, wantNotion, wantPostgres } = parseArgs(process.argv);

  let ok = true;

  if (wantPostgres) {
    const res = await checkPostgres();
    printSection('Postgres', res);
    ok = ok && res.ok;
  }

  if (wantNotion) {
    const res = await checkNotion();
    printSection('Notion', res);
    ok = ok && res.ok;
  }

  if (wantTelegram) {
    const res = await checkTelegram();
    printSection('Telegram', res);
    ok = ok && res.ok;
  }

  // eslint-disable-next-line no-console
  console.log(`\nResult: ${ok ? 'OK' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Healthcheck fatal error:', sanitizeErrorForLog(e));
  process.exitCode = 1;
});



