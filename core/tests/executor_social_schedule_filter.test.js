const test = require('node:test');
const assert = require('node:assert/strict');

const { createToolExecutor } = require('../dialogs/todo_bot_executor');

function makeBotStub() {
  const sent = [];
  return {
    sent,
    async sendMessage(chatId, text, opts) {
      sent.push({ chatId, text, opts });
      return { message_id: 1 };
    },
  };
}

test('executor: list_social_posts schedule query filters out posts without date and excludes Published/Cancelled by default', async () => {
  const bot = makeBotStub();

  const socialRepo = {
    async getOptions() {
      return { platform: ['Telegram'], status: ['Draft', 'Published', 'Cancelled'], contentType: [] };
    },
    async listPosts() {
      return [
        { id: 'p1', title: 'Draft with date', platform: 'Telegram', status: 'Draft', postDate: '2026-01-01' },
        { id: 'p2', title: 'No date', platform: 'Telegram', status: 'Draft', postDate: null },
        { id: 'p3', title: 'Published with date', platform: 'Telegram', status: 'Published', postDate: '2026-01-01' },
      ];
    },
  };

  let captured = null;

  const exec = createToolExecutor({
    bot,
    tasksRepo: null,
    ideasRepo: null,
    socialRepo,
    journalRepo: null,
    tz: 'Europe/Moscow',
    pendingToolActionByChatId: new Map(),
    lastShownListByChatId: new Map(),
    lastShownIdeasListByChatId: new Map(),
    lastShownSocialListByChatId: new Map(),
    renderAndRememberList: async () => {},
    renderAndRememberIdeasList: async () => {},
    renderAndRememberSocialList: async ({ chatId, posts, title }) => {
      captured = { chatId, posts, title };
    },
    renderAndRememberJournalList: async () => {},
    resolveJournalPageIdFromLastShown: () => null,
  });

  await exec.executeToolPlan({
    chatId: 104999109,
    from: 'tester',
    toolName: 'notion.list_social_posts',
    args: { platform: 'Telegram', dateOnOrAfter: '2026-01-01', dateBefore: '2026-01-02', limit: 10 },
    userText: 'покажи посты к публикации',
  });

  assert.ok(captured, 'expected renderAndRememberSocialList to be called');
  assert.equal(captured.chatId, 104999109);
  assert.ok(String(captured.title).includes('к публикации'), 'expected schedule title');
  assert.deepEqual(
    captured.posts.map((p) => p.id),
    ['p1'],
  );
});


