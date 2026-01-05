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

test('executor: update_idea does not change category when unknown, and sets merge.tags for "добавь тег"', async () => {
  const bot = makeBotStub();
  const pending = new Map();

  const ideasRepo = {
    async getOptions() {
      return { category: ['Concept', 'Inbox'], tags: ['Dev', 'Work'], area: [], project: [] };
    },
  };

  const exec = createToolExecutor({
    bot,
    tasksRepo: null,
    ideasRepo,
    socialRepo: null,
    journalRepo: null,
    tz: 'Europe/Moscow',
    pendingToolActionByChatId: pending,
    lastShownListByChatId: new Map(),
    lastShownIdeasListByChatId: new Map(),
    lastShownSocialListByChatId: new Map(),
    renderAndRememberList: async () => {},
    renderAndRememberIdeasList: async () => {},
    renderAndRememberSocialList: async () => {},
    renderAndRememberJournalList: async () => {},
    resolveJournalPageIdFromLastShown: () => null,
  });

  await exec.executeToolPlan({
    chatId: 104999109,
    from: 'tester',
    toolName: 'notion.update_idea',
    args: { pageId: 'idea_1', category: 'UnknownCategory', tags: ['Dev'] },
    userText: 'добавь тег dev к идее',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.update_idea');
  assert.equal(item.payload.pageId, 'idea_1');
  assert.deepEqual(item.payload.merge, { tags: true });
  assert.equal(item.payload.patch.category, undefined);
  assert.deepEqual(item.payload.patch.tags, ['Dev']);
});

test('executor: update_idea does not merge tags when user explicitly asks to replace', async () => {
  const bot = makeBotStub();
  const pending = new Map();

  const ideasRepo = {
    async getOptions() {
      return { category: ['Concept', 'Inbox'], tags: ['Dev', 'Work'], area: [], project: [] };
    },
  };

  const exec = createToolExecutor({
    bot,
    tasksRepo: null,
    ideasRepo,
    socialRepo: null,
    journalRepo: null,
    tz: 'Europe/Moscow',
    pendingToolActionByChatId: pending,
    lastShownListByChatId: new Map(),
    lastShownIdeasListByChatId: new Map(),
    lastShownSocialListByChatId: new Map(),
    renderAndRememberList: async () => {},
    renderAndRememberIdeasList: async () => {},
    renderAndRememberSocialList: async () => {},
    renderAndRememberJournalList: async () => {},
    resolveJournalPageIdFromLastShown: () => null,
  });

  await exec.executeToolPlan({
    chatId: 104999109,
    from: 'tester',
    toolName: 'notion.update_idea',
    args: { pageId: 'idea_1', tags: ['Dev'] },
    userText: 'замени теги на dev',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.update_idea');
  assert.equal(item.payload.pageId, 'idea_1');
  assert.equal(item.payload.merge, null);
  assert.deepEqual(item.payload.patch.tags, ['Dev']);
});


