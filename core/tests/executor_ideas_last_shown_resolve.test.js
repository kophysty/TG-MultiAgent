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

test('executor: update_idea resolves pageId via lastShownIdeasListByChatId index from userText', async () => {
  const bot = makeBotStub();
  const pending = new Map();
  const lastShownIdeas = new Map();
  lastShownIdeas.set(104999109, [
    { index: 1, id: 'idea_1', title: 'Idea 1' },
    { index: 2, id: 'idea_2', title: 'Idea 2' },
  ]);

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
    lastShownIdeasListByChatId: lastShownIdeas,
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
    args: { tags: ['Dev'] },
    userText: 'обнови вторую идею, добавь тег Dev',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.update_idea');
  assert.equal(item.payload.pageId, 'idea_2');
  assert.deepEqual(item.payload.patch.tags, ['Dev']);
});


