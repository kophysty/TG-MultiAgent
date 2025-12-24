const crypto = require('crypto');
const moment = require('moment');

function makeId(text) {
  return crypto.createHash('md5').update(text).digest('hex').slice(0, 8);
}

function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function buildCategoryKeyboard({ categories, taskId }) {
  const rows = [[{ text: 'Cancel', callback_data: `cancel:${taskId}` }]];
  const perRow = 3;
  for (let i = 0; i < categories.length; i += perRow) {
    const row = categories.slice(i, i + perRow).map((c) => ({
      text: c,
      callback_data: `sc:${taskId}:${c}`.slice(0, 64),
    }));
    rows.push(row);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function buildOptionsKeyboard({ prefix, taskId, category, options, pmd, priority }) {
  const row = options.map((opt) => ({
    text: String(opt),
    callback_data: `${prefix}:${taskId}:${category}:${pmd ?? 'null'}:${priority ?? 'null'}:${opt}`.slice(0, 64),
  }));
  return { reply_markup: { inline_keyboard: [row] } };
}

function buildDateKeyboard({ taskId, category, pmd, priority }) {
  const start = moment().add(1, 'days').startOf('day');
  const end = moment(start).add(29, 'days');

  const keyboard = [[{ text: 'skip', callback_data: `date:${taskId}:${category}:${pmd ?? 'null'}:${priority ?? 'null'}:skip`.slice(0, 64) }]];

  let week = [];
  while (start.isSameOrBefore(end)) {
    const dow = start.day(); // 0=Sun ... 6=Sat
    if (week.length === 0 && dow !== 1) {
      for (let i = 1; i < dow; i++) week.push({ text: ' ', callback_data: 'ignore' });
    }

    const isWeekend = dow === 0 || dow === 6;
    const btnText = isWeekend ? `*${start.format('D')}*` : start.format('D');
    week.push({
      text: btnText,
      callback_data: `date:${taskId}:${category}:${pmd ?? 'null'}:${priority ?? 'null'}:${start.format('YYYY-MM-DD')}`.slice(0, 64),
    });

    if (dow === 0 || start.isSame(end)) {
      while (week.length < 7) week.push({ text: ' ', callback_data: 'ignore' });
      keyboard.push(week);
      week = [];
    }
    start.add(1, 'days');
  }

  return { reply_markup: { inline_keyboard: keyboard } };
}

async function registerTodoBot({ bot, notionRepo, databaseId }) {
  const { tags: categoryOptions, priority: priorityOptions } = await notionRepo.getOptions();

  const TASK_CATEGORIES = categoryOptions.length ? categoryOptions : ['Today', 'Work', 'Home', 'Global', 'Everyday', 'Personal', 'Inbox'];
  const PRIORITY_OPTIONS = ['skip', ...priorityOptions.length ? priorityOptions : ['Low', 'Med', 'High']];
  const PMD_OPTIONS = ['skip', '1', '2', '3', '4', '6', '8', '10'];
  const PMD_CATEGORIES = ['Home', 'Work', 'Global', 'Personal'];
  const DATE_CATEGORIES = ['Work', 'Home'];

  const pendingTask = new Map(); // chatId -> { id, text }
  const taskTextById = new Map(); // taskId -> text
  const timers = new Map(); // chatId -> timeoutId
  const waitingFor = {
    pmd: new Set(),
    priority: new Set(),
    date: new Set(),
  };

  function clearTimer(chatId) {
    const t = timers.get(chatId);
    if (t) clearTimeout(t);
    timers.delete(chatId);
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const opts = {
      reply_markup: {
        keyboard: [[{ text: '/today' }, { text: '/list' }, { text: '/addtask' }, { text: '/struct' }]],
        resize_keyboard: true,
      },
    };
    bot.sendMessage(chatId, 'Welcome to TG-MultiAgent To-Do bot (dev).', opts);
  });

  bot.onText(/\/struct/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const db = await notionRepo.getDatabase();
      const props = db.properties || {};
      const lines = ['Structure of DB:\n'];
      for (const [k, v] of Object.entries(props)) {
        lines.push(`${k}: ${v.type}`);
      }
      bot.sendMessage(chatId, lines.join('\n'));
    } catch {
      bot.sendMessage(chatId, 'Cant get DB structure.');
    }
  });

  bot.onText(/\/addtask/, (msg) => {
    const chatId = msg.chat.id;
    pendingTask.set(chatId, { id: null, text: null });
    bot.sendMessage(chatId, 'Please enter your new task:');
  });

  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const tasks = await notionRepo.listTasks();
      const active = tasks.filter((t) => String(t.status || '').toLowerCase() !== 'done');

      if (!active.length) {
        bot.sendMessage(chatId, 'You have no active tasks in your list.');
        return;
      }

      const groups = {};
      for (const tag of TASK_CATEGORIES) groups[tag] = [];
      groups.Uncategorized = [];

      for (const t of active) {
        if (!t.tags.length) {
          groups.Uncategorized.push(t);
        } else {
          for (const tag of t.tags) {
            if (!groups[tag]) groups[tag] = [];
            groups[tag].push(t);
          }
        }
      }

      if (groups.Today) {
        const priorityOrder = { High: 1, Med: 2, Low: 3 };
        groups.Today.sort((a, b) => (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99));
      }

      let out = 'Your current active tasks:\n\n';
      for (const [groupName, items] of Object.entries(groups)) {
        if (!items.length) continue;
        out += `*${groupName}*:\n`;
        for (const item of items) out += `  - ${item.title}\n`;
        out += '\n';
      }
      bot.sendMessage(chatId, out, { parse_mode: 'Markdown' });
    } catch {
      bot.sendMessage(chatId, 'Failed to fetch tasks. Please try again later.');
    }
  });

  bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const tasks = await notionRepo.listTasks();
      const today = moment().startOf('day');

      const todayTasks = tasks.filter((t) => t.tags.includes('Today') && t.status !== 'Done');
      const dueToday = tasks.filter(
        (t) =>
          !t.tags.includes('Today') &&
          t.status !== 'Done' &&
          t.dueDate &&
          moment(t.dueDate, moment.ISO_8601, true).isValid() &&
          moment(t.dueDate).isSame(today, 'day')
      );
      const highPrio = tasks.filter((t) => !t.tags.includes('Today') && t.status !== 'Done' && t.priority === 'High');

      let out = '*Your tasks for Today:*\n\n';
      if (todayTasks.length) {
        out += '*Today category:*\n';
        todayTasks.forEach((t, i) => {
          out += `${i + 1}. ${t.title}\n`;
        });
        out += '\n';
      }
      if (dueToday.length) {
        out += '*Due today from other categories:*\n';
        dueToday.forEach((t, i) => {
          out += `${i + 1}. ${t.title} (${t.tags.join(', ')})\n`;
        });
        out += '\n';
      }
      if (highPrio.length) {
        out += '*High Priority tasks from other categories:*\n';
        highPrio.forEach((t, i) => {
          out += `${i + 1}. ${t.title} (${t.tags.join(', ')})\n`;
        });
      }
      if (!todayTasks.length && !dueToday.length && !highPrio.length) out = 'You have no active tasks for today.';

      bot.sendMessage(chatId, out, { parse_mode: 'Markdown' });
    } catch {
      bot.sendMessage(chatId, 'Failed to fetch tasks. Please try again later.');
    }
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!pendingTask.has(chatId)) return;
    if (!msg.text || msg.text.startsWith('/')) return;
    const text = msg.text.trim();
    if (!text) return;

    const id = makeId(text);
    pendingTask.set(chatId, { id, text });
    taskTextById.set(id, text);

    const truncated = truncate(text, 24);
    const kb = buildCategoryKeyboard({ categories: TASK_CATEGORIES, taskId: id });
    bot.sendMessage(chatId, `Choose a category for the task \"${truncated}\":`, kb);

    clearTimer(chatId);
    timers.set(
      chatId,
      setTimeout(async () => {
        try {
          await notionRepo.createTask({ title: text, tag: 'Today', status: 'Idle' });
          bot.sendMessage(chatId, `Category selection time expired. Task \"${truncated}\" has been added with the \"Today\" tag.`);
        } catch {
          bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
        } finally {
          pendingTask.delete(chatId);
          clearTimer(chatId);
        }
      }, 30_000)
    );
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;

    if (action === 'ignore') {
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('cancel:')) {
      clearTimer(chatId);
      pendingTask.delete(chatId);
      bot.sendMessage(chatId, 'Task addition cancelled.');
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('sc:')) {
      const [, taskId, category] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      clearTimer(chatId);

      if (PMD_CATEGORIES.includes(category)) {
        waitingFor.pmd.add(chatId);
        const kb = buildOptionsKeyboard({ prefix: 'pmd', taskId, category, options: PMD_OPTIONS });
        bot.sendMessage(chatId, `Please select the PMD value for task \"${truncatedTask}\":`, kb);
        timers.set(
          chatId,
          setTimeout(async () => {
            if (!waitingFor.pmd.has(chatId)) return;
            waitingFor.pmd.delete(chatId);
            try {
              await notionRepo.createTask({ title: fullTask, tag: category, status: 'Idle' });
              bot.sendMessage(chatId, `PMD selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with no PMD/priority/due date.`);
            } catch {
              bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
            } finally {
              pendingTask.delete(chatId);
              clearTimer(chatId);
            }
          }, 30_000)
        );
        bot.answerCallbackQuery(query.id);
        return;
      }

      if (DATE_CATEGORIES.includes(category)) {
        waitingFor.date.add(chatId);
        const kb = buildDateKeyboard({ taskId, category });
        bot.sendMessage(chatId, `Please select a due date for task \"${truncatedTask}\":`, kb);
        timers.set(
          chatId,
          setTimeout(async () => {
            if (!waitingFor.date.has(chatId)) return;
            waitingFor.date.delete(chatId);
            try {
              await notionRepo.createTask({ title: fullTask, tag: category, status: 'Idle' });
              bot.sendMessage(chatId, `Date selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" without due date.`);
            } catch {
              bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
            } finally {
              pendingTask.delete(chatId);
              clearTimer(chatId);
            }
          }, 60_000)
        );
        bot.answerCallbackQuery(query.id);
        return;
      }

      try {
        await notionRepo.createTask({ title: fullTask, tag: category, status: 'Idle' });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\".`);
      } catch {
        bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
      } finally {
        pendingTask.delete(chatId);
        clearTimer(chatId);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('pmd:')) {
      // pmd:{taskId}:{category}:{pmdValue}
      const [, taskId, category, pmdValue] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      waitingFor.pmd.delete(chatId);
      waitingFor.priority.add(chatId);
      clearTimer(chatId);

      const pmd = String(pmdValue).toLowerCase() === 'skip' ? null : Number(pmdValue);
      const kb = buildOptionsKeyboard({ prefix: 'priority', taskId, category, options: PRIORITY_OPTIONS, pmd });
      bot.sendMessage(chatId, `Please select the priority for task \"${truncatedTask}\":`, kb);

      timers.set(
        chatId,
        setTimeout(async () => {
          if (!waitingFor.priority.has(chatId)) return;
          waitingFor.priority.delete(chatId);
          try {
            await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, status: 'Idle' });
            bot.sendMessage(chatId, `Priority selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'}.`);
          } catch {
            bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
          } finally {
            pendingTask.delete(chatId);
            clearTimer(chatId);
          }
        }, 30_000)
      );

      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('priority:')) {
      // priority:{taskId}:{category}:{pmd}:{priorityOption}
      const [, taskId, category, pmdRaw, priorityOpt] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      waitingFor.priority.delete(chatId);
      clearTimer(chatId);

      const pmd = pmdRaw === 'null' ? null : Number(pmdRaw);
      const finalPriority = String(priorityOpt).toLowerCase() === 'skip' ? null : priorityOpt;

      if (DATE_CATEGORIES.includes(category)) {
        waitingFor.date.add(chatId);
        const kb = buildDateKeyboard({ taskId, category, pmd, priority: finalPriority });
        bot.sendMessage(chatId, `Please select a due date for task \"${truncatedTask}\":`, kb);

        timers.set(
          chatId,
          setTimeout(async () => {
            if (!waitingFor.date.has(chatId)) return;
            waitingFor.date.delete(chatId);
            try {
              await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, priority: finalPriority, status: 'Idle' });
              bot.sendMessage(chatId, `Date selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'} and Priority: ${finalPriority || 'not set'}.`);
            } catch {
              bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
            } finally {
              pendingTask.delete(chatId);
              clearTimer(chatId);
            }
          }, 30_000)
        );

        bot.answerCallbackQuery(query.id);
        return;
      }

      try {
        await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, priority: finalPriority, status: 'Idle' });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'} and Priority: ${finalPriority || 'not set'}.`);
      } catch {
        bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
      } finally {
        pendingTask.delete(chatId);
        clearTimer(chatId);
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('date:')) {
      // date:{taskId}:{category}:{pmd}:{priority}:{dateString}
      const [, taskId, category, pmdRaw, prioRaw, dateString] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      waitingFor.date.delete(chatId);
      clearTimer(chatId);

      const pmd = pmdRaw === 'null' ? null : Number(pmdRaw);
      const priority = prioRaw === 'null' ? null : prioRaw;
      const dueDate = String(dateString).toLowerCase() === 'skip' ? null : dateString;

      try {
        await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, priority, dueDate, status: 'Idle' });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'}, Priority: ${priority || 'not set'}, Due Date: ${dueDate || 'not set'}.`);
      } catch {
        bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
      } finally {
        pendingTask.delete(chatId);
        clearTimer(chatId);
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    bot.answerCallbackQuery(query.id);
  });

  bot.on('polling_error', (error) => {
    // Do not crash on transient errors.
    // eslint-disable-next-line no-console
    console.error('Polling error:', error);
    if (error.code === 'EFATAL') {
      setTimeout(() => {
        bot.stopPolling().then(() => bot.startPolling());
      }, 10_000);
    }
  });
}

module.exports = { registerTodoBot };


