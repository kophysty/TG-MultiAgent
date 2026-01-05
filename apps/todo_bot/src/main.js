require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { NotionTasksRepo } = require('../../../core/connectors/notion/tasks_repo');
const { NotionIdeasRepo } = require('../../../core/connectors/notion/ideas_repo');
const { NotionSocialRepo } = require('../../../core/connectors/notion/social_repo');
const { NotionJournalRepo } = require('../../../core/connectors/notion/journal_repo');
const { createPgPoolFromEnv } = require('../../../core/connectors/postgres/client');
const { EventLogRepo } = require('../../../core/connectors/postgres/event_log_repo');
const { registerTodoBot } = require('../../../core/dialogs/todo_bot');
const { sanitizeErrorForLog } = require('../../../core/runtime/log_sanitize');

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

async function notifyAdminsOnStartupFailure({ token, text }) {
  const ids = parseAdminChatIds();
  if (!ids.length) return;
  for (const chatId of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text: String(text || '') },
        { timeout: 20_000 }
      );
    } catch {
      // ignore
    }
  }
}

async function main() {
  hydrateProcessEnv();

  const mode = (process.env.TG_BOT_MODE || 'tests').toLowerCase(); // tests|prod
  const token =
    mode === 'prod'
      ? process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN
      : process.env.TELEGRAM_BOT_TOKEN_TESTS || process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error('Telegram token missing. Set TELEGRAM_BOT_TOKEN_TESTS/TELEGRAM_BOT_TOKEN_PROD (or TELEGRAM_BOT_TOKEN).');
  }

  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_TOKEN_LOCAL;
  if (!notionToken) {
    throw new Error('Notion token missing. Set NOTION_TOKEN.');
  }

  const databaseId =
    process.env.NOTION_TASKS_DB_ID ||
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_DATABASE_ID_LOCAL ||
    '2d6535c900f08191a624d325f66dbe7c';
  const tasksTestDbId = process.env.NOTION_TASKS_TEST_DB_ID || null;

  const ideasDbId = process.env.NOTION_IDEAS_DB_ID || '2d6535c900f080ea88d9cd555af22068';
  const socialDbId = process.env.NOTION_SOCIAL_DB_ID || '2d6535c900f080929233d249e1247d06';
  const journalDbId = process.env.NOTION_JOURNAL_DB_ID || '86434dfd454448599233c1832542cf79';

  const pgPool = createPgPoolFromEnv(); // optional, enabled when POSTGRES_URL is provided
  let eventLogRepo = null;
  if (pgPool) {
    const repo = new EventLogRepo({ pool: pgPool });
    try {
      await pgPool.query('SELECT 1 FROM event_log LIMIT 1');
      eventLogRepo = repo;
    } catch {
      eventLogRepo = null;
    }
  }

  const bot = new TelegramBot(token, {
    polling: true,
    cancellation: true,
    request: { timeout: 60_000 },
  });

  const tasksRepo = new NotionTasksRepo({ notionToken, databaseId, eventLogRepo });
  const tasksRepoTest = tasksTestDbId ? new NotionTasksRepo({ notionToken, databaseId: tasksTestDbId, eventLogRepo }) : null;
  const ideasRepo = new NotionIdeasRepo({ notionToken, databaseId: ideasDbId, eventLogRepo });
  const socialRepo = new NotionSocialRepo({ notionToken, databaseId: socialDbId, eventLogRepo });
  const journalRepo = new NotionJournalRepo({ notionToken, databaseId: journalDbId, eventLogRepo });

  try {
    await registerTodoBot({
      bot,
      tasksRepo,
      tasksRepoTest,
      ideasRepo,
      socialRepo,
      journalRepo,
      databaseIds: { tasks: databaseId, tasksTest: tasksTestDbId, ideas: ideasDbId, social: socialDbId, journal: journalDbId },
      pgPool,
      eventLogRepo,
      botMode: mode,
    });
  } catch (e) {
    const safe = sanitizeErrorForLog(e);
    await notifyAdminsOnStartupFailure({
      token,
      text: [
        'Todo bot: ошибка запуска.',
        `- mode: ${mode}`,
        `- error: ${safe?.code || '-'} ${safe?.message || 'unknown'}`,
        safe?.description ? `- details: ${safe.description}` : null,
        '',
        'Подсказка: проверь сеть/VPN и запусти `node core/runtime/healthcheck.js --json`.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    throw e;
  }

  // eslint-disable-next-line no-console
  console.log(`TG-MultiAgent todo bot started. mode=${mode}`);
}

process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection:', sanitizeErrorForLog(reason));
});

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught exception:', sanitizeErrorForLog(err));
  process.exitCode = 1;
});

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', sanitizeErrorForLog(err));
  process.exitCode = 1;
});


