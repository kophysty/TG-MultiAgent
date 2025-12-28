require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { NotionTasksRepo } = require('../../../core/connectors/notion/tasks_repo');
const { NotionIdeasRepo } = require('../../../core/connectors/notion/ideas_repo');
const { NotionSocialRepo } = require('../../../core/connectors/notion/social_repo');
const { createPgPoolFromEnv } = require('../../../core/connectors/postgres/client');
const { registerTodoBot } = require('../../../core/dialogs/todo_bot');

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

  const pgPool = createPgPoolFromEnv(); // optional, enabled when POSTGRES_URL is provided

  const bot = new TelegramBot(token, {
    polling: true,
    cancellation: true,
    request: { timeout: 60_000 },
  });

  const tasksRepo = new NotionTasksRepo({ notionToken, databaseId });
  const ideasRepo = new NotionIdeasRepo({ notionToken, databaseId: ideasDbId });
  const socialRepo = new NotionSocialRepo({ notionToken, databaseId: socialDbId });

  await registerTodoBot({
    bot,
    tasksRepo,
    ideasRepo,
    socialRepo,
    databaseIds: { tasks: databaseId, ideas: ideasDbId, social: socialDbId },
    pgPool,
    botMode: mode,
  });

  // eslint-disable-next-line no-console
  console.log(`TG-MultiAgent todo bot started. mode=${mode}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exitCode = 1;
});


