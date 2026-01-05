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

test('executor: update_social_post asks to pick platform when platform is unknown', async () => {
  const bot = makeBotStub();
  const socialRepo = {
    async getOptions() {
      return { platform: ['Telegram', 'Instagram'], status: ['Idea', 'Draft'], contentType: ['Post'] };
    },
  };

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
    renderAndRememberSocialList: async () => {},
    renderAndRememberJournalList: async () => {},
    resolveJournalPageIdFromLastShown: () => null,
  });

  await exec.executeToolPlan({
    chatId: 104999109,
    from: 'tester',
    toolName: 'notion.update_social_post',
    args: { platform: 'unknown_platform', title: 'x' },
    userText: 'обнови пост в неизвестной платформе',
  });

  assert.ok(bot.sent.length >= 1, 'expected a sendMessage call');
  assert.ok(String(bot.sent[0].text).toLowerCase().includes('выбери'), 'expected pick message');
  const kb = bot.sent[0].opts?.reply_markup?.inline_keyboard;
  assert.ok(Array.isArray(kb), 'expected inline keyboard');
});



