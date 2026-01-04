const fs = require('fs');
const path = require('path');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { createPgPoolFromEnv } = require('../../../core/connectors/postgres/client');
const { sanitizeForEventLog, sanitizeTextForStorage } = require('../../../core/runtime/log_sanitize');
const { makeTraceId } = require('../../../core/runtime/trace');
const todoBotPkg = require('../../todo_bot/package.json');
const workerPkg = require('../../reminders_worker/package.json');

function parseArgs(argv) {
  const out = {
    chatId: null,
    sinceHours: 24,
    outPath: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chat-id' && argv[i + 1]) out.chatId = Number(argv[++i]);
    if (a === '--since-hours' && argv[i + 1]) out.sinceHours = Number(argv[++i]);
    if (a === '--out' && argv[i + 1]) out.outPath = String(argv[++i]);
  }
  return out;
}

function safeEnvSnapshot() {
  const keys = [
    'TG_BOT_MODE',
    'TG_TZ',
    'TG_DEBUG',
    'TG_AI',
    'TG_AI_MODEL',
    'POSTGRES_URL',
    'NOTION_TASKS_DB_ID',
    'NOTION_IDEAS_DB_ID',
    'NOTION_SOCIAL_DB_ID',
    'NOTION_JOURNAL_DB_ID',
    'NOTION_PREFERENCES_DB_ID',
    'NOTION_PREFERENCE_PROFILES_DB_ID',
  ];
  const out = {};
  for (const k of keys) {
    const v = process.env[k];
    if (v === undefined) continue;
    if (k.toLowerCase().includes('token') || k.toLowerCase().includes('key') || k.toLowerCase().includes('url')) {
      out[k] = v ? '<REDACTED>' : v;
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

async function main() {
  hydrateProcessEnv();
  const args = parseArgs(process.argv);
  const traceId = makeTraceId();

  const now = new Date();
  const since = new Date(now.getTime() - Math.max(1, Number(args.sinceHours || 24)) * 3600_000);

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const defaultOut = path.join(repoRoot, 'data', 'diag', `bundle-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  const outPath = args.outPath ? path.resolve(repoRoot, args.outPath) : defaultOut;

  const bundle = {
    traceId,
    createdAt: now.toISOString(),
    sinceIso: since.toISOString(),
    versions: {
      node: process.version,
      platform: process.platform,
      todoBot: todoBotPkg.version,
      remindersWorker: workerPkg.version,
    },
    env: safeEnvSnapshot(),
    pg: { ok: false, info: null, slices: {} },
  };

  const pool = createPgPoolFromEnv();
  if (!pool) {
    bundle.pg.ok = false;
    bundle.pg.info = 'POSTGRES_URL missing';
  } else {
    try {
      await pool.query('select 1 as ok');
      bundle.pg.ok = true;
    } catch (e) {
      bundle.pg.ok = false;
      bundle.pg.info = sanitizeForEventLog(e);
    }

    if (bundle.pg.ok) {
      const chatId = Number.isFinite(args.chatId) ? args.chatId : null;
      const params = [since.toISOString()];

      // event_log slice (optional)
      try {
        const where = chatId ? 'chat_id = $2 AND ts >= $1::timestamptz' : 'ts >= $1::timestamptz';
        if (chatId) params.push(chatId);
        const q = `select ts, trace_id, chat_id, component, event, level, duration_ms, payload from event_log where ${where} order by ts desc limit 500`;
        const r = await pool.query(q, params);
        bundle.pg.slices.event_log = r.rows || [];
      } catch (e) {
        bundle.pg.slices.event_log = { error: sanitizeForEventLog(e) };
      }

      // chat memory slice (optional)
      try {
        if (chatId) {
          const r = await pool.query(
            'select role, left(text, 200) as text_preview, created_at from chat_messages where chat_id = $1 order by created_at desc limit 200',
            [chatId]
          );
          bundle.pg.slices.chat_messages = r.rows || [];
          const s = await pool.query('select summary, updated_at, last_message_id from chat_summaries where chat_id = $1', [chatId]);
          bundle.pg.slices.chat_summary = s.rows?.[0] || null;
        }
      } catch (e) {
        bundle.pg.slices.chat_memory = { error: sanitizeForEventLog(e) };
      }

      // reminder + sync slices
      try {
        const r = await pool.query('select chat_id, page_id, reminder_kind, remind_at, created_at from sent_reminders order by created_at desc limit 200');
        bundle.pg.slices.sent_reminders = r.rows || [];
      } catch (e) {
        bundle.pg.slices.sent_reminders = { error: sanitizeForEventLog(e) };
      }

      try {
        const r = await pool.query(
          'select id, kind, external_id, attempt, next_run_at, created_at from notion_sync_queue order by id desc limit 200'
        );
        bundle.pg.slices.notion_sync_queue = r.rows || [];
      } catch (e) {
        bundle.pg.slices.notion_sync_queue = { error: sanitizeForEventLog(e) };
      }
    }

    try {
      await pool.end();
    } catch {}
  }

  const sanitizedBundleText = sanitizeTextForStorage(JSON.stringify(sanitizeForEventLog(bundle), null, 2));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, sanitizedBundleText, 'utf8');

  // eslint-disable-next-line no-console
  console.log(outPath);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('diag bundle fatal error', e);
  process.exitCode = 1;
});


