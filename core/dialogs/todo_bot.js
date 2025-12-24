const crypto = require('crypto');
const moment = require('moment');
const { aiAnalyzeMessage } = require('../ai/todo_intent');

function isDebugEnabled() {
  const v = String(process.env.TG_DEBUG || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isAiEnabled() {
  const v = String(process.env.TG_AI || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function debugLog(event, fields = {}) {
  if (!isDebugEnabled()) return;
  // Never log secrets. Keep payloads small and mostly metadata.
  // eslint-disable-next-line no-console
  console.log(`[tg_debug] ${event}`, fields);
}

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

function buildAiConfirmKeyboard({ draftId }) {
  const rows = [
    [
      { text: 'Подтвердить', callback_data: `ai:confirm:${draftId}`.slice(0, 64) },
      { text: 'Отмена', callback_data: `ai:cancel:${draftId}`.slice(0, 64) },
    ],
  ];
  return { reply_markup: { inline_keyboard: rows } };
}

function formatAiTaskSummary(task) {
  const title = task?.title || '(без названия)';
  const dueDate = task?.dueDate || 'не указана';
  const priority = task?.priority || 'не указан';
  const pmd = typeof task?.pmd === 'number' ? String(task.pmd) : 'не указан';
  const tag = Array.isArray(task?.tags) && task.tags.length ? task.tags[0] : null;

  const lines = [
    'Я понял задачу так:',
    `- Название: ${title}`,
    `- Дата: ${dueDate}`,
    `- Приоритет: ${priority}`,
    `- PMD: ${pmd}`,
    `- Категория: ${tag || 'не указана'}`,
    '',
    'Верно?',
    'Если нужно поправить, просто напиши исправление текстом.',
  ];

  return lines.join('\n');
}

async function registerTodoBot({ bot, notionRepo, databaseId }) {
  debugLog('bot_init', { databaseId: String(databaseId) });
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

  // AI: in-memory drafts, no persistence yet.
  const aiDraftByChatId = new Map(); // chatId -> { id, task, updatedAt, awaitingConfirmation }
  const aiDraftById = new Map(); // id -> { chatId, task, updatedAt, awaitingConfirmation }
  const tz = process.env.TG_TZ || 'Europe/Moscow';
  const aiModel = process.env.TG_AI_MODEL || 'gpt-4.1-mini';
  const PRIORITY_SET = new Set(PRIORITY_OPTIONS.filter((p) => p && p !== 'skip'));

  function normalizePriorityForDb(priority) {
    if (!priority) return null;
    if (PRIORITY_SET.has(priority)) return priority;
    // Common mismatch: "Medium" vs "Med"
    if (priority === 'Medium' && PRIORITY_SET.has('Med')) return 'Med';
    return null;
  }

  function clearTimer(chatId) {
    const t = timers.get(chatId);
    if (t) clearTimeout(t);
    timers.delete(chatId);
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    debugLog('incoming_command', { chatId, command: '/start', from: msg.from?.username || null });
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
    debugLog('incoming_command', { chatId, command: '/struct', from: msg.from?.username || null });
    try {
      debugLog('notion_call', { op: 'getDatabase' });
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
    debugLog('incoming_command', { chatId, command: '/addtask', from: msg.from?.username || null });
    pendingTask.set(chatId, { id: null, text: null });
    bot.sendMessage(chatId, 'Please enter your new task:');
  });

  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    debugLog('incoming_command', { chatId, command: '/list', from: msg.from?.username || null });
    try {
      debugLog('notion_call', { op: 'listTasks' });
      const tasks = await notionRepo.listTasks();
      debugLog('notion_result', { op: 'listTasks', count: tasks.length });
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
    debugLog('incoming_command', { chatId, command: '/today', from: msg.from?.username || null });
    try {
      debugLog('notion_call', { op: 'listTasks' });
      const tasks = await notionRepo.listTasks();
      debugLog('notion_result', { op: 'listTasks', count: tasks.length });
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
    const from = msg.from?.username || null;

    // Ignore commands here (handled by onText handlers).
    if (msg.text && msg.text.startsWith('/')) return;

    // Manual /addtask flow (existing behavior).
    if (pendingTask.has(chatId)) {
      if (!msg.text) return;
      const text = msg.text.trim();
      if (!text) return;

      debugLog('incoming_task_text', {
        chatId,
        from,
        text_len: text.length,
        text_preview: text.slice(0, 32),
      });

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
            debugLog('notion_call', { op: 'createTask', tag: 'Today', status: 'Idle' });
            await notionRepo.createTask({ title: text, tag: 'Today', status: 'Idle' });
            debugLog('notion_result', { op: 'createTask', ok: true });
            bot.sendMessage(chatId, `Category selection time expired. Task \"${truncated}\" has been added with the \"Today\" tag.`);
          } catch {
            debugLog('notion_result', { op: 'createTask', ok: false });
            bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
          } finally {
            pendingTask.delete(chatId);
            clearTimer(chatId);
          }
        }, 30_000)
      );
      return;
    }

    // AI: ignore non-text messages for now.
    if (!msg.text) return;

    if (!isAiEnabled()) return;

    const text = msg.text.trim();
    if (!text) return;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      bot.sendMessage(chatId, 'AI включен, но OPENAI_API_KEY не найден. Проверь .env.');
      return;
    }

    const existingDraft = aiDraftByChatId.get(chatId) || null;
    const priorTaskDraft = existingDraft?.task || null;

    debugLog('ai_call', {
      model: aiModel,
      tz,
      chatId,
      from,
      has_prior_draft: Boolean(priorTaskDraft),
      text_len: text.length,
      text_preview: text.slice(0, 48),
    });

    try {
      const { normalized } = await aiAnalyzeMessage({
        apiKey,
        model: aiModel,
        tz,
        nowIso: new Date().toISOString(),
        userText: text,
        priorTaskDraft,
      });

      debugLog('ai_result', { type: normalized.type });

      if (normalized.type === 'question') {
        bot.sendMessage(chatId, normalized.question.answer);
        return;
      }

      const draftId = existingDraft?.id || makeId(`${chatId}:${Date.now()}:${normalized.task.title}`);
      const task = normalized.task;

      const draft = {
        id: draftId,
        task,
        updatedAt: Date.now(),
        awaitingConfirmation: true,
      };

      aiDraftByChatId.set(chatId, draft);
      aiDraftById.set(draftId, { ...draft, chatId });

      const kb = buildAiConfirmKeyboard({ draftId });
      bot.sendMessage(chatId, formatAiTaskSummary(task), kb);
    } catch (e) {
      debugLog('ai_error', { message: String(e?.message || e) });
      bot.sendMessage(chatId, 'Не получилось обработать сообщение через AI. Попробуй еще раз или используй /addtask.');
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;
    debugLog('incoming_callback', { chatId, data: String(action).slice(0, 80) });

    if (action && action.startsWith('ai:')) {
      const [, act, draftId] = action.split(':');
      const entry = aiDraftById.get(draftId);

      if (!entry || entry.chatId !== chatId) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Черновик не найден или устарел. Напиши задачу еще раз.');
        return;
      }

      if (act === 'cancel') {
        aiDraftById.delete(draftId);
        aiDraftByChatId.delete(chatId);
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Ок, отменил.');
        return;
      }

      if (act === 'confirm') {
        const task = entry.task;
        const tag = Array.isArray(task?.tags) && task.tags.length ? task.tags[0] : null;
        const priority = normalizePriorityForDb(task.priority ?? null);

        try {
          debugLog('notion_call', { op: 'createTask', tag, status: 'Idle' });
          await notionRepo.createTask({
            title: task.title,
            tag,
            pmd: task.pmd ?? null,
            priority,
            dueDate: task.dueDate ?? null,
            status: 'Idle',
          });
          debugLog('notion_result', { op: 'createTask', ok: true });
          bot.sendMessage(chatId, 'Готово, добавил задачу в Notion.');
        } catch {
          debugLog('notion_result', { op: 'createTask', ok: false });
          bot.sendMessage(chatId, 'Не получилось создать задачу в Notion. Попробуй еще раз.');
        } finally {
          aiDraftById.delete(draftId);
          aiDraftByChatId.delete(chatId);
        }

        bot.answerCallbackQuery(query.id);
        return;
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

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
              debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
              await notionRepo.createTask({ title: fullTask, tag: category, status: 'Idle' });
              debugLog('notion_result', { op: 'createTask', ok: true });
              bot.sendMessage(chatId, `PMD selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with no PMD/priority/due date.`);
            } catch {
              debugLog('notion_result', { op: 'createTask', ok: false });
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
              debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
              await notionRepo.createTask({ title: fullTask, tag: category, status: 'Idle' });
              debugLog('notion_result', { op: 'createTask', ok: true });
              bot.sendMessage(chatId, `Date selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" without due date.`);
            } catch {
              debugLog('notion_result', { op: 'createTask', ok: false });
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
        debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: category, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\".`);
      } catch {
        debugLog('notion_result', { op: 'createTask', ok: false });
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
            debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
            await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, status: 'Idle' });
            debugLog('notion_result', { op: 'createTask', ok: true });
            bot.sendMessage(chatId, `Priority selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'}.`);
          } catch {
            debugLog('notion_result', { op: 'createTask', ok: false });
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
              debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
              await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, priority: finalPriority, status: 'Idle' });
              debugLog('notion_result', { op: 'createTask', ok: true });
              bot.sendMessage(chatId, `Date selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'} and Priority: ${finalPriority || 'not set'}.`);
            } catch {
              debugLog('notion_result', { op: 'createTask', ok: false });
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
        debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, priority: finalPriority, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'} and Priority: ${finalPriority || 'not set'}.`);
      } catch {
        debugLog('notion_result', { op: 'createTask', ok: false });
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
        debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: category, pmd: pmd ?? null, priority, dueDate, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with PMD: ${pmd ?? 'not set'}, Priority: ${priority || 'not set'}, Due Date: ${dueDate || 'not set'}.`);
      } catch {
        debugLog('notion_result', { op: 'createTask', ok: false });
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
    debugLog('polling_error', { code: error?.code || null, message: String(error?.message || '') });
    if (error.code === 'EFATAL') {
      setTimeout(() => {
        bot.stopPolling().then(() => bot.startPolling());
      }, 10_000);
    }
  });
}

module.exports = { registerTodoBot };


