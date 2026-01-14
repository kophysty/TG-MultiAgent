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

test('executor: update_task resolves pageId via taskIndex from lastShownListByChatId', async () => {
  const bot = makeBotStub();
  const pending = new Map();
  const lastShown = new Map();
  lastShown.set(104999109, [
    { index: 1, id: 't1', title: 'Task 1' },
    { index: 2, id: 't2', title: 'Task 2' },
  ]);

  const exec = createToolExecutor({
    bot,
    tasksRepo: {
      async getOptions() {
        return { status: [], priority: [] };
      },
    },
    ideasRepo: null,
    socialRepo: null,
    journalRepo: null,
    tz: 'Europe/Moscow',
    pendingToolActionByChatId: pending,
    lastShownListByChatId: lastShown,
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
    toolName: 'notion.update_task',
    args: { taskIndex: 2, tag: 'Today', title: 'new title' },
    userText: 'обнови вторую задачу',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.update_task');
  assert.equal(item.payload.pageId, 't2');
  assert.deepEqual(item.payload.patch, { title: 'new title', tag: 'Inbox', priority: undefined, dueDate: undefined, status: undefined });
});

test('executor: move_to_deprecated includes resolved title from lastShownListByChatId', async () => {
  const bot = makeBotStub();
  const pending = new Map();
  const lastShown = new Map();
  lastShown.set(104999109, [
    { index: 1, id: 't1', title: 'Task 1' },
    { index: 2, id: 't2', title: 'Task 2' },
  ]);

  const exec = createToolExecutor({
    bot,
    tasksRepo: {}, // not used in this flow
    ideasRepo: null,
    socialRepo: null,
    journalRepo: null,
    tz: 'Europe/Moscow',
    pendingToolActionByChatId: pending,
    lastShownListByChatId: lastShown,
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
    toolName: 'notion.move_to_deprecated',
    args: { taskIndex: 2 },
    userText: 'удали вторую задачу',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.move_to_deprecated');
  assert.equal(item.payload.pageId, 't2');
  assert.equal(item.payload.title, 'Task 2');

  assert.ok(bot.sent.length >= 1, 'expected a sendMessage call');
  assert.ok(String(bot.sent[0].text).includes('Task 2'), 'expected title line');
  assert.ok(String(bot.sent[0].text).toLowerCase().includes('deprecated'), 'expected Deprecated confirmation');
});


