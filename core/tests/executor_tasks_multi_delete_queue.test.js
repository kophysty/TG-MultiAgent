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

test('executor: move_to_deprecated supports multi-query queue and falls back to next query when first yields nothing', async () => {
  const bot = makeBotStub();
  const pending = new Map();

  const tasksRepo = {
    async findTasks({ queryText }) {
      const q = String(queryText || '');
      if (q.includes('Task B')) {
        return [{ id: 'tb', title: 'Task B', tags: [] }];
      }
      return [];
    },
    async listTasks() {
      return [];
    },
  };

  const exec = createToolExecutor({
    bot,
    tasksRepo,
    ideasRepo: null,
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
    toolName: 'notion.move_to_deprecated',
    args: { queryText: 'Task A; Task B' },
    userText: 'удали Task A и Task B',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.move_to_deprecated');
  assert.equal(item.payload.pageId, 'tb');
  assert.equal(item.payload.title, 'Task B');
  assert.equal(item.payload._queueQueries, undefined);

  assert.ok(bot.sent.length >= 1, 'expected a sendMessage call');
  assert.ok(String(bot.sent[0].text).includes('Task B'), 'expected title line');
});


