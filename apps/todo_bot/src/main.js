require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { NotionTasksRepo } = require('../../../core/connectors/notion/tasks_repo');
const { NotionIdeasRepo } = require('../../../core/connectors/notion/ideas_repo');
const { NotionSocialRepo } = require('../../../core/connectors/notion/social_repo');
const { NotionJournalRepo } = require('../../../core/connectors/notion/journal_repo');
const { createPgPoolFromEnv } = require('../../../core/connectors/postgres/client');
const { registerTodoBot } = require('../../../core/dialogs/todo_bot');
const { sanitizeErrorForLog } = require('../../../core/runtime/log_sanitize');

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

  const ideasDbId = process.env.NOTION_IDEAS_DB_ID || '2d6535c900f080ea88d9cd555af22068';
  const socialDbId = process.env.NOTION_SOCIAL_DB_ID || '2d6535c900f080929233d249e1247d06';
  const journalDbId = process.env.NOTION_JOURNAL_DB_ID || '86434dfd454448599233c1832542cf79';

  const pgPool = createPgPoolFromEnv(); // optional, enabled when POSTGRES_URL is provided

  const bot = new TelegramBot(token, {
    polling: true,
    cancellation: true,
    request: { timeout: 60_000 },
  });

  const tasksRepo = new NotionTasksRepo({ notionToken, databaseId });
  const ideasRepo = new NotionIdeasRepo({ notionToken, databaseId: ideasDbId });
  const socialRepo = new NotionSocialRepo({ notionToken, databaseId: socialDbId });
  const journalRepo = new NotionJournalRepo({ notionToken, databaseId: journalDbId });

  await registerTodoBot({
    bot,
    tasksRepo,
    ideasRepo,
    socialRepo,
    journalRepo,
    databaseIds: { tasks: databaseId, ideas: ideasDbId, social: socialDbId, journal: journalDbId },
    pgPool,
    botMode: mode,
  });

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


