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

test('executor: update_social_post resolves pageId via taskIndex from lastShownSocialListByChatId', async () => {
  const bot = makeBotStub();
  const pending = new Map();
  const lastShownSocial = new Map();
  lastShownSocial.set(104999109, [{ index: 1, id: 'post_1', title: 'Post 1' }]);

  const socialRepo = {
    async getOptions() {
      return { platform: ['Telegram'], status: ['Draft'], contentType: [] };
    },
  };

  const exec = createToolExecutor({
    bot,
    tasksRepo: null,
    ideasRepo: null,
    socialRepo,
    journalRepo: null,
    tz: 'Europe/Moscow',
    pendingToolActionByChatId: pending,
    lastShownListByChatId: new Map(),
    lastShownIdeasListByChatId: new Map(),
    lastShownSocialListByChatId: lastShownSocial,
    renderAndRememberList: async () => {},
    renderAndRememberIdeasList: async () => {},
    renderAndRememberSocialList: async () => {},
    renderAndRememberJournalList: async () => {},
    resolveJournalPageIdFromLastShown: () => null,
  });

  await exec.executeToolPlan({
    chatId: 104999109,
    from: 'tester',
    toolName: 'notion.update_social_post',
    args: { taskIndex: 1, title: 'New title' },
    userText: 'обнови первый пост',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.update_social_post');
  assert.equal(item.payload.pageId, 'post_1');
  assert.equal(item.payload.patch.title, 'New title');
});


