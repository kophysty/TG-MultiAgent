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

test('executor: update_journal_entry with type=null keeps patch.type=null (null clears field)', async () => {
  const bot = makeBotStub();
  const pending = new Map();

  const journalRepo = {
    async getOptions() {
      return { type: ['Итог дня', 'Мысль'], topics: ['Работа'], context: ['дом'] };
    },
    async listEntries() {
      return [];
    },
  };

  const exec = createToolExecutor({
    bot,
    tasksRepo: null,
    ideasRepo: null,
    socialRepo: null,
    journalRepo,
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
    toolName: 'notion.update_journal_entry',
    args: { pageId: 'page_1', type: null },
    userText: 'убери тип у записи',
  });

  const item = pending.get(104999109);
  assert.ok(item, 'expected pending tool action');
  assert.equal(item.kind, 'notion.update_journal_entry');
  assert.equal(item.payload.pageId, 'page_1');
  assert.equal(item.payload.patch.type, null);
});



