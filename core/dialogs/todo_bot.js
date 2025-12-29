const crypto = require('crypto');
const moment = require('moment');
const { aiAnalyzeMessage } = require('../ai/todo_intent');
const todoBotPkg = require('../../apps/todo_bot/package.json');
const fs = require('fs');

const { downloadTelegramFileToTmp } = require('../connectors/telegram/files');
const { convertOggToWav16kMono } = require('../connectors/stt/ffmpeg');
const { transcribeWavWithOpenAI } = require('../connectors/stt/openai_whisper');
const { planAgentAction } = require('../ai/agent_planner');
const { classifyConfirmIntent } = require('../ai/confirm_intent');

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

async function safeEditStatus({ bot, chatId, messageId, text }) {
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId });
  } catch {
    // Ignore edit failures (message deleted, rate limits, etc.).
  }
}

function makeId(text) {
  return crypto.createHash('md5').update(text).digest('hex').slice(0, 8);
}

function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function oneLinePreview(text, maxLen) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(t, maxLen);
}

function inferDateFromText({ userText, tz }) {
  const t = String(userText || '').toLowerCase();
  if (!t) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  if (/\b(сегодня)\b/.test(t)) return yyyyMmDdInTz({ tz, date: new Date() });
  if (/\b(послезавтра)\b/.test(t)) return yyyyMmDdInTz({ tz, date: new Date(Date.now() + 2 * dayMs) });
  if (/\b(завтра)\b/.test(t)) return yyyyMmDdInTz({ tz, date: new Date(Date.now() + dayMs) });

  // Simple date patterns: YYYY-MM-DD or DD.MM.YYYY
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (ru) {
    const dd = String(ru[1]).padStart(2, '0');
    const mm = String(ru[2]).padStart(2, '0');
    return `${ru[3]}-${mm}-${dd}`;
  }

  return null;
}

function yyyyMmDdInTz({ tz, date = new Date() }) {
  // Returns YYYY-MM-DD in the specified IANA timezone.
  // Uses Intl, no extra deps.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function inferListHintsFromText(userText) {
  const t = String(userText || '').trim().toLowerCase();
  if (!t) return { preset: null, tag: null, doneMode: 'exclude' };

  // Done filter hints:
  // - default: exclude Done tasks from lists
  // - only: show only Done tasks when user explicitly asks for completed
  // - include: show all tasks including Done when user explicitly asks to include completed
  const hasDoneWords = /\b(выполненн|выполнен|завершенн|завершен|сделанн|сделан|done|completed)\b/.test(t);
  const hasNegation = /\b(не\s*выполн|невыполн|не\s*заверш|незаверш|не\s*сделан|несделан)\b/.test(t);
  const hasIncludeWords = /\b(включая|с\s+учет(ом)?|с\s+выполненными|с\s+завершенными|все\s+.*выполн)\b/.test(t);

  let doneMode = 'exclude';
  if (hasDoneWords && !hasNegation) {
    doneMode = hasIncludeWords ? 'include' : 'only';
  }

  // "today" list intent: due today + inbox (alias).
  // Prefer "на сегодня" phrasing to avoid collision with "Today=Inbox" alias.
  const isTodayPreset = /\bна\s+сегодня\b/.test(t) || /\bсегодняшн/.test(t) || /\bзадач(и|а)\s+на\s+сегодня\b/.test(t);
  if (isTodayPreset) return { preset: 'today', tag: null, doneMode };

  // Category synonyms (RU -> Notion Tag)
  if (/\bинбокс\b/.test(t) || /\bвходящ/.test(t) || /\btoday\b/.test(t)) return { preset: null, tag: 'Inbox', doneMode };
  if (/\bдомашн/.test(t) || /\bдом\b/.test(t)) return { preset: null, tag: 'Home', doneMode };
  if (/\bрабоч/.test(t) || /\bработа\b/.test(t)) return { preset: null, tag: 'Work', doneMode };

  return { preset: null, tag: null, doneMode };
}

function buildQueryVariants(queryText) {
  const raw = String(queryText || '').trim();
  const base = raw.replace(/\s+/g, ' ').trim();
  const variants = [];
  const push = (s) => {
    const v = String(s || '').trim();
    if (!v) return;
    if (!variants.includes(v)) variants.push(v);
  };

  push(base);
  // remove quotes that might appear in voice/text
  push(base.replace(/^["'«»]+|["'«»]+$/g, '').trim());

  // digits glued: "1 2 3 4 cool" -> "1234 cool"
  const gluedDigits = base.replace(/\b(\d)\s+(?=\d\b)/g, '$1').replace(/\s+/g, ' ').trim();
  push(gluedDigits);
  // aggressive: remove spaces between digit groups: "1 2 3 4" -> "1234"
  push(base.replace(/\s+/g, '').trim());

  return variants.slice(0, 5);
}

async function findTasksFuzzy({ notionRepo, queryText, limit }) {
  const tries = buildQueryVariants(queryText);
  const seen = new Set();
  let best = [];
  let bestQuery = tries[0] || queryText;

  for (const q of tries) {
    const res = await notionRepo.findTasks({ queryText: q, limit });
    const uniq = [];
    for (const t of res || []) {
      if (!t?.id) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      uniq.push(t);
    }
    if (uniq.length > best.length) {
      best = uniq;
      bestQuery = q;
    }
    if (best.length >= 2) break; // good enough, stop early
  }

  return { tasks: best, usedQueryText: bestQuery };
}

function normalizeCategoryInput(category) {
  const c = String(category || '').trim();
  if (!c) return null;
  if (c.toLowerCase() === 'deprecated') return null;
  // UI alias: Today -> Inbox (Notion tag).
  if (c.toLowerCase() === 'today') return 'Inbox';
  return c;
}

function normalizeTagsForDisplay(tags) {
  const out = [];
  for (const t of tags || []) {
    const name = String(t || '').trim();
    if (!name) continue;
    if (name.toLowerCase() === 'deprecated') continue;
    // Display alias: Inbox -> Today (so UX stays familiar).
    if (name.toLowerCase() === 'inbox') out.push('Today');
    else out.push(name);
  }
  return out;
}

function isAffirmativeText(text) {
  const t = String(text || '').trim().toLowerCase();
  return (
    t === 'да' ||
    t === 'ага' ||
    t === 'угу' ||
    t === 'ок' ||
    t === 'окей' ||
    t === 'okay' ||
    t === 'подтверждаю' ||
    t === 'подтвердить' ||
    t === 'согласен' ||
    t === 'верно' ||
    t === 'правильно' ||
    t === 'точно' ||
    t === 'хорошо' ||
    t === 'давай'
  );
}

function isNegativeText(text) {
  const t = String(text || '').trim().toLowerCase();
  return t === 'нет' || t === 'не' || t === 'отмена' || t === 'отменить' || t === 'не надо';
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

function buildToolConfirmKeyboard({ actionId }) {
  const rows = [
    [
      { text: 'Подтвердить', callback_data: `tool:confirm:${actionId}`.slice(0, 64) },
      { text: 'Отмена', callback_data: `tool:cancel:${actionId}`.slice(0, 64) },
    ],
  ];
  return { reply_markup: { inline_keyboard: rows } };
}

function formatAiTaskSummary(task) {
  const title = task?.title || '(без названия)';
  const dueDate = task?.dueDate || 'не указана';
  const priority = task?.priority || 'не указан';
  const tag = Array.isArray(task?.tags) && task.tags.length ? task.tags[0] : null;
  const displayTag = tag && String(tag).trim().toLowerCase() === 'inbox' ? 'Today' : tag;

  const lines = [
    'Я понял задачу так:',
    `- Название: ${title}`,
    `- Дата: ${dueDate}`,
    `- Приоритет: ${priority}`,
    `- Категория: ${displayTag || 'не указана'}`,
    '',
    'Верно?',
    'Если нужно поправить, просто напиши исправление текстом.',
  ];

  return lines.join('\n');
}

const { RemindersRepo } = require('../connectors/postgres/reminders_repo');

function normalizeTitleKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .trim();
}

// Social platform aliases - normalize RU/EN variations to short tokens
// that can be matched against Notion options (e.g., "FB", "TG  __ ForNoDevs").
const SOCIAL_PLATFORM_ALIASES = {
  facebook: 'fb',
  fb: 'fb',
  фб: 'fb',
  фейсбук: 'fb',
  facebok: 'fb',
  telegram: 'tg',
  tg: 'tg',
  тг: 'tg',
  телеграм: 'tg',
  телега: 'tg',
  tiktok: 'tiktok',
  тикток: 'tiktok',
  тиктокк: 'tiktok',
  instagram: 'instagram',
  insta: 'instagram',
  инстаграм: 'instagram',
  инста: 'instagram',
  youtube: 'youtube',
  yt: 'youtube',
  ютуб: 'youtube',
  linkedin: 'linkedin',
  линкедин: 'linkedin',
  twitter: 'twitter',
  твиттер: 'twitter',
  x: 'x',
};

const SOCIAL_STATUS_ALIASES = {
  idea: 'idea',
  postidea: 'idea',
  draft: 'draft',
  черновик: 'draft',
  planned: 'planned',
  запланировано: 'planned',
  запланирован: 'planned',
  published: 'published',
  опубликовано: 'published',
  опубликован: 'published',
  done: 'published',
};

// Normalize arbitrary user/LLM input to a Notion option name.
// This avoids Notion errors like "option not found" for select/multi_select/status fields.
function normalizeOptionKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function pickBestOptionMatch({ input, options, aliases = null }) {
  if (input === null) return { value: null, unknown: null };
  if (input === undefined) return { value: undefined, unknown: null };

  const raw = String(input || '').trim();
  if (!raw) return { value: null, unknown: null };

  const opts = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!opts.length) return { value: raw, unknown: null };

  // Exact match (case-insensitive) first.
  const lower = raw.toLowerCase();
  const exact = opts.find((o) => String(o).toLowerCase() === lower);
  if (exact) return { value: exact, unknown: null };

  const wantedKey = normalizeOptionKey(raw);
  const byKey = new Map(opts.map((o) => [normalizeOptionKey(o), o]));
  if (byKey.has(wantedKey)) return { value: byKey.get(wantedKey), unknown: null };

  const token = aliases && Object.prototype.hasOwnProperty.call(aliases, wantedKey) ? aliases[wantedKey] : wantedKey;
  const candidates = opts
    .map((o) => ({ option: o, key: normalizeOptionKey(o) }))
    .filter((x) => x.key === token || x.key.startsWith(token) || x.key.includes(token));

  if (!candidates.length) return { value: null, unknown: raw };

  // Prefer the shortest (more canonical) match.
  candidates.sort((a, b) => a.key.length - b.key.length);
  return { value: candidates[0].option, unknown: null };
}

function normalizeMultiOptionValue({ value, options, aliases = null }) {
  if (value === null) return { value: null, unknown: [] };
  if (value === undefined) return { value: undefined, unknown: [] };

  const arr = Array.isArray(value) ? value : [value];
  const normalized = [];
  const unknown = [];
  for (const it of arr) {
    const { value: v, unknown: u } = pickBestOptionMatch({ input: it, options, aliases });
    if (u) unknown.push(u);
    if (v) normalized.push(v);
  }
  const uniq = Array.from(new Set(normalized));
  return { value: uniq, unknown };
}

function normalizeSocialPlatform({ platform, platforms }) {
  if (platform === null || platform === undefined) return { ok: true, value: platform, unknown: [] };
  const { value, unknown } = normalizeMultiOptionValue({ value: platform, options: platforms, aliases: SOCIAL_PLATFORM_ALIASES });
  if (unknown.length) return { ok: false, value: null, unknown };
  // Preserve shape: string in, string out. Array in, array out.
  if (!Array.isArray(platform)) return { ok: true, value: value[0] || null, unknown: [] };
  return { ok: true, value, unknown: [] };
}

function normalizeSocialContentType({ contentType, contentTypes }) {
  if (contentType === null || contentType === undefined) return { value: contentType };
  const { value } = normalizeMultiOptionValue({ value: contentType, options: contentTypes, aliases: null });
  if (!Array.isArray(contentType)) return { value: value[0] || null };
  return { value };
}

function normalizeSocialStatus({ status, statuses }) {
  if (status === null || status === undefined) return { value: status };
  const { value } = pickBestOptionMatch({ input: status, options: statuses, aliases: SOCIAL_STATUS_ALIASES });
  return { value: value || null };
}

function extractNotionErrorInfo(e) {
  const status = e?.response?.status || null;
  const data = e?.response?.data || null;
  const code = data?.code || null;
  const message = data?.message || e?.message || String(e);
  const headers = e?.response?.headers || {};
  const requestId = headers['x-request-id'] || headers['request-id'] || null;

  let short = message;
  if (code) short = `${code}: ${short}`;
  if (status) short = `HTTP ${status} ${short}`;
  if (requestId) short = `${short} (request_id: ${requestId})`;

  return { status, code, message, requestId, short };
}

function buildPickPlatformKeyboard({ actionId, platforms }) {
  const rows = [];
  const perRow = 2;
  for (let i = 0; i < platforms.length; i += perRow) {
    const row = [];
    for (let j = i; j < Math.min(i + perRow, platforms.length); j++) {
      row.push({ text: String(platforms[j]), callback_data: `plat:${actionId}:${j}`.slice(0, 64) });
    }
    rows.push(row);
  }
  rows.push([{ text: 'Отмена', callback_data: `tool:cancel:${actionId}`.slice(0, 64) }]);
  return { reply_markup: { inline_keyboard: rows } };
}

async function registerTodoBot({ bot, tasksRepo, ideasRepo, socialRepo, databaseIds, pgPool = null, botMode = 'tests' }) {
  debugLog('bot_init', { databaseIds });
  const { tags: categoryOptions, priority: priorityOptions } = await tasksRepo.getOptions();
  const remindersRepo = pgPool ? new RemindersRepo({ pool: pgPool }) : null;
  // Legacy alias used by older command handlers and manual flows.
  // Keep it to avoid accidental "notionRepo is not defined" runtime errors.
  const notionRepo = tasksRepo;

  // Categories are dynamic from Notion Tags. Exclude Deprecated from any user-facing menus and AI.
  const notionCategories = (categoryOptions || []).filter((c) => String(c || '').trim().toLowerCase() !== 'deprecated');
  const hasInbox = notionCategories.some((c) => String(c || '').trim().toLowerCase() === 'inbox');

  // UI: keep "Today" as an alias for Inbox (even if Today tag does not exist in Notion).
  // Never show "Deprecated" here.
  const TASK_CATEGORIES = notionCategories.length ? ['Today', ...notionCategories.filter((c) => String(c || '').trim().toLowerCase() !== 'inbox')] : ['Today', 'Work', 'Home', 'Global', 'Everyday', 'Personal'];
  const PRIORITY_OPTIONS = ['skip', ...priorityOptions.length ? priorityOptions : ['Low', 'Med', 'High']];
  const DATE_CATEGORIES = ['Work', 'Home'];

  const pendingTask = new Map(); // chatId -> { id, text }
  const taskTextById = new Map(); // taskId -> text
  const timers = new Map(); // chatId -> timeoutId
  const waitingFor = {
    priority: new Set(),
    date: new Set(),
  };

  // AI: in-memory drafts, no persistence yet.
  const aiDraftByChatId = new Map(); // chatId -> { id, task, updatedAt, awaitingConfirmation }
  const aiDraftById = new Map(); // id -> { chatId, task, updatedAt, awaitingConfirmation }
  const pendingToolActionByChatId = new Map(); // chatId -> { id, kind, payload, createdAt }
  const lastShownListByChatId = new Map(); // chatId -> [{ index, id, title }]
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

  function defaultFallbackCategory() {
    // Prefer Inbox if present in Notion options, otherwise null.
    if (hasInbox) return 'Inbox';
    return null;
  }

  async function confirmAiDraft({ chatId, draftId, queryId }) {
    const entry = aiDraftById.get(draftId);
    if (!entry || entry.chatId !== chatId) {
      if (queryId) bot.answerCallbackQuery(queryId);
      bot.sendMessage(chatId, 'Черновик не найден или устарел. Напиши задачу еще раз.');
      return;
    }

    const task = entry.task;
    const rawTag = Array.isArray(task?.tags) && task.tags.length ? task.tags[0] : null;
    const tag = normalizeCategoryInput(rawTag) || defaultFallbackCategory();
    const priority = normalizePriorityForDb(task.priority ?? null);

    try {
      debugLog('notion_call', { op: 'createTask', tag, status: 'Idle' });
      await tasksRepo.createTask({
        title: task.title,
        tag,
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

    if (queryId) bot.answerCallbackQuery(queryId);
  }

  function cancelAiDraft({ chatId, draftId, queryId }) {
    if (draftId) aiDraftById.delete(draftId);
    aiDraftByChatId.delete(chatId);
    if (queryId) bot.answerCallbackQuery(queryId);
    bot.sendMessage(chatId, 'Ок, отменил.');
  }

  function buildPickTaskKeyboard({ items }) {
    const rows = [];
    for (const it of items.slice(0, 10)) {
      rows.push([{ text: `${it.index}. ${truncate(it.title, 24)}`, callback_data: `pick:${it.index}`.slice(0, 64) }]);
    }
    rows.push([{ text: 'Отмена', callback_data: 'pick:cancel' }]);
    return { reply_markup: { inline_keyboard: rows } };
  }

  async function renderAndRememberList({ chatId, tasks, title }) {
    const shown = tasks.slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownListByChatId.set(chatId, shown);

    if (!shown.length) {
      bot.sendMessage(chatId, `${title}\n\n(пусто)`);
      return;
    }

    const lines = [title, ''];
    for (const it of shown) {
      lines.push(`${it.index}. ${it.title}`);
    }
    bot.sendMessage(chatId, lines.join('\n'));
  }

  async function executeToolPlan({ chatId, from, toolName, args, userText }) {
    try {
      debugLog('tool_call', { tool: toolName, chatId, from });

      if (toolName === 'notion.list_tasks') {
        const hinted = inferListHintsFromText(userText);
        const preset = args?.preset ? String(args.preset).trim().toLowerCase() : hinted.preset;
        const tag =
          args?.tag
            ? normalizeCategoryInput(args.tag)
            : hinted.tag
              ? normalizeCategoryInput(hinted.tag)
              : null;
        const status = args?.status ? String(args.status) : null;
        const includeDoneArg = typeof args?.includeDone === 'boolean' ? args.includeDone : null;
        const doneOnlyArg = typeof args?.doneOnly === 'boolean' ? args.doneOnly : null;
        const doneMode =
          doneOnlyArg === true
            ? 'only'
            : includeDoneArg === true
              ? 'include'
              : status && String(status).trim().toLowerCase() === 'done'
                ? 'only'
                : hinted.doneMode || 'exclude';
        let dueDate = args?.dueDate ? String(args.dueDate).trim() : null;
        const queryText = args?.queryText ? String(args.queryText) : null;

        if (dueDate && (dueDate.toLowerCase() === 'today' || dueDate.toLowerCase() === 'сегодня')) {
          dueDate = yyyyMmDdInTz({ tz });
        }

        let tasks = [];
        if (preset === 'today') {
          const today = yyyyMmDdInTz({ tz });
          const queryStatus = doneMode === 'only' ? 'Done' : null;
          const byDate = await tasksRepo.listTasks({ dueDate: today, status: queryStatus, limit: 100 });
          const inbox = await tasksRepo.listTasks({ tag: 'Inbox', status: queryStatus, limit: 100 });
          const seen = new Set();
          for (const x of [...byDate, ...inbox]) {
            if (!x || !x.id) continue;
            if (seen.has(x.id)) continue;
            seen.add(x.id);
            tasks.push(x);
          }
        } else {
          const queryStatus = status || (doneMode === 'only' ? 'Done' : null);
          tasks = await tasksRepo.listTasks({ tag, status: queryStatus, dueDate, queryText, limit: 100 });
        }

        let filtered = tasks.filter((t) => !t.tags.includes('Deprecated'));

        if (doneMode === 'exclude') {
          filtered = filtered.filter((t) => String(t.status || '').trim().toLowerCase() !== 'done');
        } else if (doneMode === 'only') {
          filtered = filtered.filter((t) => String(t.status || '').trim().toLowerCase() === 'done');
        } else {
          // include -> do nothing
        }

        const title = doneMode === 'only' ? 'Твои выполненные задачи:' : 'Твои задачи:';
        await renderAndRememberList({ chatId, tasks: filtered, title });
        return;
      }

      if (toolName === 'notion.find_tasks') {
        const queryText = String(args?.queryText || '').trim();
        const { tasks } = await findTasksFuzzy({ notionRepo: tasksRepo, queryText, limit: 20 });
        const filtered = tasks.filter((t) => !t.tags.includes('Deprecated'));
        await renderAndRememberList({ chatId, tasks: filtered, title: `Найдено по "${queryText}":` });
        return;
      }

      if (toolName === 'notion.create_task') {
        const title = String(args?.title || '').trim();
        const tag = args?.tag ? normalizeCategoryInput(args.tag) : null;
        const priority = args?.priority ? String(args.priority) : null;
        const dueDate = args?.dueDate ? String(args.dueDate) : null;
        const status = args?.status ? String(args.status) : 'Idle';
        const description = args?.description ? String(args.description) : null;

        // Dedup check: if a similar active task exists, ask before creating a duplicate.
        const key = normalizeTitleKey(title);
        const candidates = (await tasksRepo.findTasks({ queryText: title, limit: 10 })).filter((t) => !t.tags.includes('Deprecated'));
        const dupe = candidates.find((t) => normalizeTitleKey(t.title) === key);
        if (dupe) {
          const actionId = makeId(`${chatId}:${Date.now()}:notion.create_task:${key}`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'notion.create_task',
            payload: { title, tag, priority, dueDate, status, description },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, `Похоже, такая задача уже есть: "${dupe.title}". Создать дубль?`, buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const created = await tasksRepo.createTask({ title, tag, priority, dueDate, status });
        if (description) await tasksRepo.appendDescription({ pageId: created.id, text: description });
        bot.sendMessage(chatId, `Готово. Создал задачу: ${created.title}`);
        return;
      }

      if (toolName === 'notion.list_ideas') {
        const queryText = args?.queryText ? String(args.queryText) : null;
        const status = args?.status ? String(args.status) : null;
        const category = args?.category ? args.category : null;
        const limit = args?.limit ? Number(args.limit) : 15;
        const ideas = await ideasRepo.listIdeas({ category, status, queryText, limit });
        const lines = ['Идеи:', ''];
        for (const it of ideas.slice(0, 20)) {
          lines.push(`- ${it.title}`);
        }
        bot.sendMessage(chatId, lines.join('\n'));
        return;
      }

      if (toolName === 'notion.create_idea') {
        const title = String(args?.title || '').trim();
        const status = args?.status ? String(args.status) : 'Inbox';
        const priority = args?.priority ? String(args.priority) : null;
        let category = args?.category ?? null; // string|array|null
        const source = args?.source ? String(args.source) : undefined;
        const description = args?.description ? String(args.description) : null;

        // Prevent creating new Category options: match only against existing Notion options.
        const { category: categoryOptions } = await ideasRepo.getOptions();
        if (category !== null && category !== undefined) {
          const norm = normalizeMultiOptionValue({ value: category, options: categoryOptions, aliases: null });
          if (norm.unknown.length) {
            // If we cannot match, prefer leaving empty rather than creating a new option.
            const concept = (categoryOptions || []).find((c) => String(c).trim().toLowerCase() === 'concept') || null;
            category = concept ? concept : null;
          } else {
            category = Array.isArray(category) ? norm.value : norm.value[0] || null;
          }
        } else if (category === null) {
          // If category not provided, default to Concept if present (generic bucket).
          const concept = (categoryOptions || []).find((c) => String(c).trim().toLowerCase() === 'concept') || null;
          if (concept) category = concept;
        }

        const key = normalizeTitleKey(title);
        const candidates = await ideasRepo.listIdeas({ queryText: title, limit: 10 });
        const dupe = candidates.find((t) => normalizeTitleKey(t.title) === key);
        if (dupe) {
          const actionId = makeId(`${chatId}:${Date.now()}:notion.create_idea:${key}`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'notion.create_idea',
            payload: { title, status, priority, category, source, description },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, `Похоже, такая идея уже есть: "${dupe.title}". Создать дубль?`, buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const created = await ideasRepo.createIdea({ title, status, priority, category, source });
        if (description) await ideasRepo.appendDescription({ pageId: created.id, text: description });
        bot.sendMessage(chatId, `Готово. Добавил идею: ${created.title}`);
        return;
      }

      if (toolName === 'notion.update_idea') {
        const { category: categoryOptions } = await ideasRepo.getOptions();
        let normCategory = args?.category !== undefined ? args.category : undefined;
        if (normCategory !== undefined && normCategory !== null) {
          const norm = normalizeMultiOptionValue({ value: normCategory, options: categoryOptions, aliases: null });
          if (norm.unknown.length) {
            // Unknown category: do not change existing value (avoid clearing by mistake).
            normCategory = undefined;
          } else {
            normCategory = Array.isArray(normCategory) ? norm.value : norm.value[0] || null;
          }
        }

        const patch = {
          title: args?.title ? String(args.title) : undefined,
          status: args?.status ? String(args.status) : undefined,
          priority: args?.priority ? String(args.priority) : undefined,
          category: normCategory,
          source: args?.source !== undefined ? String(args.source) : undefined,
        };
        // resolve pageId via shared logic below
        args = { ...args, _patch: patch };
        toolName = 'notion.update_idea_resolve';
      }

      if (toolName === 'notion.archive_idea') {
        toolName = 'notion.archive_idea_resolve';
      }

      if (toolName === 'notion.list_social_posts') {
        const queryText = args?.queryText ? String(args.queryText) : null;
        const rawStatus = args?.status ? String(args.status) : null;
        const rawPlatform = args?.platform ?? null;
        const limit = args?.limit ? Number(args.limit) : 15;

        const { platform: platforms, status: statuses } = await socialRepo.getOptions();
        const status = normalizeSocialStatus({ status: rawStatus, statuses }).value;
        const normPlatform = normalizeSocialPlatform({ platform: rawPlatform, platforms });
        if (!normPlatform.ok) {
          const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform_list`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'social.pick_platform_list',
            payload: { draft: { queryText, status, limit }, platforms },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Выбери платформу для списка:', buildPickPlatformKeyboard({ actionId, platforms }));
          return;
        }

        const posts = await socialRepo.listPosts({ platform: normPlatform.value, status, queryText, limit });
        const lines = ['Посты (Social Media Planner):', ''];
        for (const it of posts.slice(0, 20)) {
          const plats = it.platform?.length ? ` [${it.platform.join(', ')}]` : '';
          lines.push(`- ${it.title}${plats}`);
        }
        bot.sendMessage(chatId, lines.join('\n'));
        return;
      }

      if (toolName === 'notion.create_social_post') {
        const title = String(args?.title || '').trim();
        const platform = args?.platform ?? null; // string|array|null
        const postDate = args?.postDate ? String(args.postDate) : null;
        const contentType = args?.contentType ?? null;
        const status = args?.status ? String(args.status) : 'Post Idea';
        const postUrl = args?.postUrl ? String(args.postUrl) : null;
        const description = args?.description ? String(args.description) : null;

        const { platform: platforms, status: statuses, contentType: contentTypes } = await socialRepo.getOptions();
        const normalizedStatus = normalizeSocialStatus({ status, statuses }).value || 'Post Idea';
        const normalizedContentType = normalizeSocialContentType({ contentType, contentTypes }).value;
        const inferredDate = !postDate ? inferDateFromText({ userText, tz }) : null;
        const effectivePostDate = postDate || inferredDate;

        if (!platform || (Array.isArray(platform) && !platform.length)) {
          const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'social.pick_platform',
            payload: {
              draft: { title, postDate: effectivePostDate, contentType: normalizedContentType, status: normalizedStatus, postUrl, description },
              platforms,
            },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Выбери платформу для поста:', buildPickPlatformKeyboard({ actionId, platforms }));
          return;
        }

        const normPlatform = normalizeSocialPlatform({ platform, platforms });
        if (!normPlatform.ok) {
          const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'social.pick_platform',
            payload: {
              draft: { title, postDate: effectivePostDate, contentType: normalizedContentType, status: normalizedStatus, postUrl, description },
              platforms,
            },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Не понял платформу. Выбери из списка:', buildPickPlatformKeyboard({ actionId, platforms }));
          return;
        }

        const key = normalizeTitleKey(title);
        const candidates = await socialRepo.listPosts({ queryText: title, limit: 10 });
        const dupe = candidates.find((t) => normalizeTitleKey(t.title) === key);
        if (dupe) {
          const actionId = makeId(`${chatId}:${Date.now()}:notion.create_social_post:${key}`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'notion.create_social_post',
            payload: {
              title,
              platform: normPlatform.value,
              postDate: effectivePostDate,
              contentType: normalizedContentType,
              status: normalizedStatus,
              postUrl,
              description,
            },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, `Похоже, такой пост уже есть: "${dupe.title}". Создать дубль?`, buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const created = await socialRepo.createPost({
          title,
          platform: normPlatform.value,
          postDate: effectivePostDate,
          contentType: normalizedContentType,
          status: normalizedStatus,
          postUrl,
        });
        if (description) await socialRepo.appendDescription({ pageId: created.id, text: description });
        bot.sendMessage(chatId, `Готово. Добавил пост: ${created.title}`);
        return;
      }

      if (toolName === 'notion.update_social_post') {
        const { platform: platforms, status: statuses, contentType: contentTypes } = await socialRepo.getOptions();

        // If user/LLM provided a platform that does not match Notion options, ask to pick it.
        if (args?.platform !== undefined && args.platform !== null) {
          const normPlatform = normalizeSocialPlatform({ platform: args.platform, platforms });
          if (!normPlatform.ok) {
            const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform_update`);
            pendingToolActionByChatId.set(chatId, {
              id: actionId,
              kind: 'social.pick_platform_update',
              payload: { draft: { ...args }, platforms },
              createdAt: Date.now(),
            });
            bot.sendMessage(chatId, 'Не понял платформу для обновления. Выбери из списка:', buildPickPlatformKeyboard({ actionId, platforms }));
            return;
          }
          args = { ...args, platform: normPlatform.value };
        }

        const patch = {
          title: args?.title ? String(args.title) : undefined,
          status: args?.status ? normalizeSocialStatus({ status: String(args.status), statuses }).value : undefined,
          platform: args?.platform !== undefined ? args.platform : undefined,
          postDate: args?.postDate !== undefined ? String(args.postDate) : undefined,
          contentType: args?.contentType !== undefined ? normalizeSocialContentType({ contentType: args.contentType, contentTypes }).value : undefined,
          postUrl: args?.postUrl !== undefined ? String(args.postUrl) : undefined,
        };
        args = { ...args, _patch: patch };
        toolName = 'notion.update_social_post_resolve';
      }

      if (toolName === 'notion.archive_social_post') {
        toolName = 'notion.archive_social_post_resolve';
      }

      // Domain-specific resolution (ideas/social) before falling back to tasks resolution.
      if (toolName === 'notion.update_idea_resolve' || toolName === 'notion.archive_idea_resolve') {
        const pageId = args?.pageId ? String(args.pageId) : null;
        if (pageId) {
          const actionId = makeId(`${chatId}:${Date.now()}:${toolName}:${pageId}`);
          if (toolName === 'notion.update_idea_resolve') {
            pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.update_idea', payload: { pageId, patch: args._patch }, createdAt: Date.now() });
            bot.sendMessage(chatId, 'Применить изменения к идее?', buildToolConfirmKeyboard({ actionId }));
            return;
          }
          pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_idea', payload: { pageId }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Архивировать эту идею?', buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const queryText = String(args?.queryText || '').trim();
        const candidates = (await ideasRepo.listIdeas({ queryText, limit: 10 })) || [];
        if (candidates.length === 1) {
          args = { ...args, pageId: candidates[0].id };
          return await executeToolPlan({ chatId, from, toolName, args, userText });
        }
        if (candidates.length > 1) {
          const items = candidates.map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, { id: null, kind: toolName === 'notion.update_idea_resolve' ? 'notion.update_idea' : 'notion.archive_idea', payload: { _candidates: items, patch: args._patch }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Нашел несколько идей. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }
        bot.sendMessage(chatId, 'Не нашел идею. Уточни запрос.');
        return;
      }

      if (toolName === 'notion.update_social_post_resolve' || toolName === 'notion.archive_social_post_resolve') {
        const pageId = args?.pageId ? String(args.pageId) : null;
        if (pageId) {
          const actionId = makeId(`${chatId}:${Date.now()}:${toolName}:${pageId}`);
          if (toolName === 'notion.update_social_post_resolve') {
            pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.update_social_post', payload: { pageId, patch: args._patch }, createdAt: Date.now() });
            bot.sendMessage(chatId, 'Применить изменения к посту?', buildToolConfirmKeyboard({ actionId }));
            return;
          }
          pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_social_post', payload: { pageId }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Архивировать этот пост?', buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const queryText = String(args?.queryText || '').trim();
        const candidates = (await socialRepo.listPosts({ queryText, limit: 10 })) || [];
        if (candidates.length === 1) {
          args = { ...args, pageId: candidates[0].id };
          return await executeToolPlan({ chatId, from, toolName, args, userText });
        }
        if (candidates.length > 1) {
          const items = candidates.map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, { id: null, kind: toolName === 'notion.update_social_post_resolve' ? 'notion.update_social_post' : 'notion.archive_social_post', payload: { _candidates: items, patch: args._patch }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Нашел несколько постов. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }
        bot.sendMessage(chatId, 'Не нашел пост. Уточни запрос.');
        return;
      }

      // Tasks resolution: use either taskIndex (from last list) or pageId.
      const pageId = args?.pageId ? String(args.pageId) : null;
      const taskIndex = args?.taskIndex ? Number(args.taskIndex) : null;
      let resolvedPageId = pageId;

      if (!resolvedPageId && taskIndex && lastShownListByChatId.has(chatId)) {
        const found = (lastShownListByChatId.get(chatId) || []).find((x) => x.index === taskIndex);
        if (found) resolvedPageId = found.id;
      }

      if (!resolvedPageId && args?.queryText) {
        const queryText = String(args.queryText).trim();
        const fuzzy = await findTasksFuzzy({ notionRepo: tasksRepo, queryText, limit: 10 });
        const candidates = (fuzzy.tasks || []).filter((t) => !t.tags.includes('Deprecated'));
        if (candidates.length === 1) resolvedPageId = candidates[0].id;
        if (candidates.length > 1) {
          const items = candidates.map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, { id: null, kind: toolName, payload: { ...args, _candidates: items }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Нашел несколько задач. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }
      }

      if (!resolvedPageId) {
        bot.sendMessage(chatId, 'Не понял, к какой задаче применить действие. Напиши номер из списка или уточни название.');
        return;
      }

      if (toolName === 'notion.mark_done') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.mark_done:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.mark_done', payload: { pageId: resolvedPageId }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Пометить задачу как выполненную?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.move_to_deprecated') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.move_to_deprecated:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.move_to_deprecated', payload: { pageId: resolvedPageId }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Перенести задачу в Deprecated?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.update_task') {
        const patch = {
          title: args?.title ? String(args.title) : undefined,
          tag: args?.tag ? normalizeCategoryInput(args.tag) : undefined,
          priority: args?.priority ? String(args.priority) : undefined,
          dueDate: args?.dueDate ? String(args.dueDate) : undefined,
          status: args?.status ? String(args.status) : undefined,
        };
        const actionId = makeId(`${chatId}:${Date.now()}:notion.update_task:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.update_task', payload: { pageId: resolvedPageId, patch }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Применить изменения к задаче?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.append_description') {
        const text = String(args?.text || '').trim();
        const actionId = makeId(`${chatId}:${Date.now()}:notion.append_description:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.append_description', payload: { pageId: resolvedPageId, text }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Добавить это в описание задачи?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.update_idea_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.update_idea:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.update_idea', payload: { pageId: resolvedPageId, patch: args._patch }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Применить изменения к идее?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.archive_idea_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.archive_idea:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_idea', payload: { pageId: resolvedPageId }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Архивировать эту идею?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.update_social_post_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.update_social_post:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.update_social_post', payload: { pageId: resolvedPageId, patch: args._patch }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Применить изменения к посту?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.archive_social_post_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.archive_social_post:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_social_post', payload: { pageId: resolvedPageId }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Архивировать этот пост?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      bot.sendMessage(chatId, 'Неизвестная операция.');
    } catch (e) {
      const err = extractNotionErrorInfo(e);
      debugLog('tool_error', { tool: toolName, message: err.message, code: err.code, status: err.status, requestId: err.requestId });

      const debug = String(process.env.TG_DEBUG || '') === '1';
      if (debug) {
        bot.sendMessage(chatId, `Ошибка Notion: ${truncate(err.short, 800)}`);
      } else {
        bot.sendMessage(chatId, 'Ошибка при выполнении операции с Notion.');
      }
    }
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
        keyboard: [
          [{ text: '/today' }, { text: '/list' }, { text: '/addtask' }, { text: '/struct' }],
          [{ text: '/reminders_on' }, { text: '/reminders_off' }],
        ],
        resize_keyboard: true,
      },
    };
    const version = todoBotPkg?.version ? `v${todoBotPkg.version}` : 'v0.0.0';
    bot.sendMessage(chatId, `Welcome to TG-MultiAgent To-Do bot (dev). Version: ${version}`, opts);

    // Auto-subscribe chat to reminders if Postgres is configured.
    if (remindersRepo) {
      remindersRepo
        .upsertSubscription({ chatId, botMode, enabled: true })
        .then(() => debugLog('reminders_subscribed', { chatId, enabled: true }))
        .catch((e) => debugLog('reminders_subscribe_error', { chatId, message: String(e?.message || e) }));
    }
  });

  bot.onText(/\/reminders_on/, async (msg) => {
    const chatId = msg.chat.id;
    debugLog('incoming_command', { chatId, command: '/reminders_on', from: msg.from?.username || null });
    if (!remindersRepo) {
      bot.sendMessage(chatId, 'Postgres не настроен. Добавь POSTGRES_URL в .env и перезапусти бота.');
      return;
    }
    try {
      await remindersRepo.upsertSubscription({ chatId, botMode, enabled: true });
      bot.sendMessage(chatId, 'Ок. Напоминалки включены.');
    } catch {
      bot.sendMessage(chatId, 'Не получилось включить напоминалки. Проверь Postgres и повтори.');
    }
  });

  bot.onText(/\/reminders_off/, async (msg) => {
    const chatId = msg.chat.id;
    debugLog('incoming_command', { chatId, command: '/reminders_off', from: msg.from?.username || null });
    if (!remindersRepo) {
      bot.sendMessage(chatId, 'Postgres не настроен. Добавь POSTGRES_URL в .env и перезапусти бота.');
      return;
    }
    try {
      await remindersRepo.upsertSubscription({ chatId, botMode, enabled: false });
      bot.sendMessage(chatId, 'Ок. Напоминалки выключены.');
    } catch {
      bot.sendMessage(chatId, 'Не получилось выключить напоминалки. Проверь Postgres и повтори.');
    }
  });

  bot.onText(/\/struct/, async (msg) => {
    const chatId = msg.chat.id;
    debugLog('incoming_command', { chatId, command: '/struct', from: msg.from?.username || null });
    try {
      debugLog('notion_call', { op: 'getDatabase' });
      const db = await tasksRepo.getDatabase();
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
      const tasks = await tasksRepo.listTasks();
      debugLog('notion_result', { op: 'listTasks', count: tasks.length });
      const active = tasks.filter((t) => String(t.status || '').toLowerCase() !== 'done' && !t.tags.includes('Deprecated'));

      if (!active.length) {
        bot.sendMessage(chatId, 'You have no active tasks in your list.');
        return;
      }

      const groups = {};
      for (const tag of TASK_CATEGORIES) groups[tag] = [];
      groups.Uncategorized = [];

      for (const t of active) {
        const displayTags = normalizeTagsForDisplay(t.tags);
        if (!displayTags.length) {
          groups.Uncategorized.push(t);
        } else {
          for (const tag of displayTags) {
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
      const tasks = await tasksRepo.listTasks();
      debugLog('notion_result', { op: 'listTasks', count: tasks.length });
      const today = moment().startOf('day');

      const todayTasks = tasks.filter((t) => t.tags.includes('Inbox') && t.status !== 'Done' && !t.tags.includes('Deprecated'));
      const dueToday = tasks.filter(
        (t) =>
          !t.tags.includes('Inbox') &&
          t.status !== 'Done' &&
          !t.tags.includes('Deprecated') &&
          t.dueDate &&
          moment(t.dueDate, moment.ISO_8601, true).isValid() &&
          moment(t.dueDate).isSame(today, 'day')
      );
      const highPrio = tasks.filter((t) => !t.tags.includes('Inbox') && t.status !== 'Done' && !t.tags.includes('Deprecated') && t.priority === 'High');

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

    // Voice pipeline (minimal v1):
    // 1) download OGG/OPUS by file_id
    // 2) ffmpeg -> wav 16k mono
    // 3) Whisper STT
    // 4) feed transcript into existing AI flow (task/question)
    if (msg.voice && msg.voice.file_id) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        bot.sendMessage(chatId, 'Voice получен, но OPENAI_API_KEY не найден. Проверь .env.');
        return;
      }

      const sttModel = process.env.TG_STT_MODEL || 'whisper-1';
      const lang = process.env.TG_STT_LANGUAGE || 'ru';

      debugLog('voice_received', {
        chatId,
        from,
        duration: msg.voice.duration || null,
        file_unique_id: msg.voice.file_unique_id || null,
      });

      const statusMsg = await bot.sendMessage(chatId, 'Voice: скачиваю...');
      const statusMessageId = statusMsg?.message_id;

      let oggPath = null;
      let wavPath = null;

      try {
        const dl = await downloadTelegramFileToTmp({ bot, fileId: msg.voice.file_id, prefix: 'tg_voice', ext: 'ogg' });
        oggPath = dl.outPath;
        debugLog('voice_downloaded', { chatId, bytes: fs.statSync(oggPath).size });

        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: конвертирую (ffmpeg)...' });
        const conv = await convertOggToWav16kMono({ inputPath: oggPath });
        wavPath = conv.wavPath;

        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: распознаю (STT)...' });
        const stt = await transcribeWavWithOpenAI({ apiKey, wavPath, model: sttModel, language: lang });
        const transcript = stt.text;

        debugLog('voice_transcribed', { chatId, text_len: transcript.length, text_preview: transcript.slice(0, 80) });

        if (!transcript) {
          if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: не удалось распознать текст.' });
          return;
        }

        const transcriptPreview = oneLinePreview(transcript, 90);

        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: формирую задачу...' });

        // Voice transcript should go through the same planner->tools path as text messages.
        const allowedCategories = notionCategories.length ? notionCategories : ['Inbox'];
        const lastShown = lastShownListByChatId.get(chatId) || [];
        try {
          const plan = await planAgentAction({
            apiKey,
            model: aiModel,
            userText: transcript,
            allowedCategories,
            lastShownList: lastShown,
          });

          if (plan.type === 'chat') {
            if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: `Распознано: ${transcriptPreview}` });
            bot.sendMessage(chatId, plan.chat.message);
            return;
          }

          if (plan.type === 'tool') {
            if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: выполняю...' });
            await executeToolPlan({ chatId, from, toolName: plan.tool.name, args: plan.tool.args, userText: transcript });
            if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: `Распознано: ${transcriptPreview}` });
            return;
          }
        } catch (e) {
          debugLog('planner_error', { source: 'voice', message: String(e?.message || e) });
          // Fall back to legacy AI intent analyzer and draft confirmation flow.
        }

        // Fallback: legacy task/question -> draft confirmation (kept for robustness).
        const existingDraft = aiDraftByChatId.get(chatId) || null;
        const priorTaskDraft = existingDraft?.task || null;

        const { normalized } = await aiAnalyzeMessage({
          apiKey,
          model: aiModel,
          tz,
          nowIso: new Date().toISOString(),
          userText: transcript,
          priorTaskDraft,
          allowedCategories,
        });

        debugLog('ai_result', { type: normalized.type, source: 'voice_fallback' });

        if (normalized.type === 'question') {
          if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: `Распознано: ${transcriptPreview}` });
          bot.sendMessage(chatId, normalized.question.answer);
          return;
        }

        const draftId = existingDraft?.id || makeId(`${chatId}:${Date.now()}:${normalized.task.title}`);
        const task = normalized.task;
        const rawAiTag = Array.isArray(task.tags) && task.tags.length ? task.tags[0] : null;
        const normalizedTag = normalizeCategoryInput(rawAiTag);

        const allowedMap = new Map(allowedCategories.map((c) => [String(c).trim().toLowerCase(), c]));
        const canonical = normalizedTag ? allowedMap.get(String(normalizedTag).trim().toLowerCase()) : null;
        const finalTag = canonical || 'Inbox';
        task.tags = [finalTag];

        const draft = { id: draftId, task, updatedAt: Date.now(), awaitingConfirmation: true };
        aiDraftByChatId.set(chatId, draft);
        aiDraftById.set(draftId, { ...draft, chatId });

        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: `Распознано: ${transcriptPreview}` });
        const kb = buildAiConfirmKeyboard({ draftId });
        bot.sendMessage(chatId, formatAiTaskSummary(task), kb);
      } catch (e) {
        debugLog('voice_error', { chatId, message: String(e?.message || e) });
        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: ошибка при обработке.' });
        bot.sendMessage(chatId, 'Не получилось обработать voice. Попробуй еще раз или отправь текстом.');
      } finally {
        try {
          if (oggPath) fs.unlinkSync(oggPath);
        } catch {}
        try {
          if (wavPath) fs.unlinkSync(wavPath);
        } catch {}
      }
      return;
    }

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
            debugLog('notion_call', { op: 'createTask', tag: 'Inbox', status: 'Idle' });
            await notionRepo.createTask({ title: text, tag: 'Inbox', status: 'Idle' });
            debugLog('notion_result', { op: 'createTask', ok: true });
            bot.sendMessage(chatId, `Category selection time expired. Task \"${truncated}\" has been added to \"Inbox\".`);
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

    // If a draft is awaiting confirmation, allow text-based confirm/cancel.
    const existingDraft = aiDraftByChatId.get(chatId) || null;
    if (existingDraft?.awaitingConfirmation) {
      if (isAffirmativeText(text)) {
        await confirmAiDraft({ chatId, draftId: existingDraft.id, queryId: null });
        return;
      }
      if (isNegativeText(text)) {
        cancelAiDraft({ chatId, draftId: existingDraft.id, queryId: null });
        return;
      }
      // Otherwise classify intent (confirm/cancel/edit) with AI fallback.
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      bot.sendMessage(chatId, 'AI включен, но OPENAI_API_KEY не найден. Проверь .env.');
      return;
    }

    // AI draft confirm fallback (semantic): if we are awaiting confirmation and user didn't match rules,
    // try to classify as confirm/cancel/edit.
    if (existingDraft?.awaitingConfirmation) {
      let intent = 'unknown';
      try {
        intent = await classifyConfirmIntent({ apiKey, model: aiModel, userText: text, context: 'ai_task_draft' });
      } catch {
        intent = 'unknown';
      }

      if (intent === 'confirm') {
        await confirmAiDraft({ chatId, draftId: existingDraft.id, queryId: null });
        return;
      }
      if (intent === 'cancel') {
        cancelAiDraft({ chatId, draftId: existingDraft.id, queryId: null });
        return;
      }
      // If "edit" or "unknown" - fall through to treat as correction and rerun AI task parser below.
    }

    // Pending tool confirmations: use rule-based, then AI fallback.
    const pending = pendingToolActionByChatId.get(chatId) || null;
    if (pending) {
      const ruleConfirm = isAffirmativeText(text) ? 'confirm' : isNegativeText(text) ? 'cancel' : null;
      let intent = ruleConfirm;
      if (!intent) {
        try {
          intent = await classifyConfirmIntent({ apiKey, model: aiModel, userText: text, context: pending.kind });
        } catch {
          intent = 'unknown';
        }
      }

      if (intent === 'cancel') {
        pendingToolActionByChatId.delete(chatId);
        bot.sendMessage(chatId, 'Ок, отменил.');
        return;
      }

      if (intent === 'confirm') {
        const kind = pending.kind;
        const payload = pending.payload;
        pendingToolActionByChatId.delete(chatId);
        try {
          if (kind === 'notion.mark_done') {
            await notionRepo.markDone({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Пометил как выполнено.');
            return;
          }
          if (kind === 'notion.move_to_deprecated') {
            await notionRepo.moveToDeprecated({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Перенес в Deprecated.');
            return;
          }
          if (kind === 'notion.update_task') {
            await notionRepo.updateTask({ pageId: payload.pageId, ...payload.patch });
            bot.sendMessage(chatId, 'Готово. Обновил задачу.');
            return;
          }
          if (kind === 'notion.append_description') {
            await notionRepo.appendDescription({ pageId: payload.pageId, text: payload.text });
            bot.sendMessage(chatId, 'Готово. Добавил описание.');
            return;
          }
        } catch {
          bot.sendMessage(chatId, 'Не получилось выполнить действие в Notion.');
          return;
        }
      }

      // If user is editing instead of confirming, treat the message as a new instruction and fall through.
    }

    // Agent planner: try tool-based action first.
    const allowedCategories = notionCategories.length ? notionCategories : ['Inbox'];
    try {
      const lastShown = lastShownListByChatId.get(chatId) || [];
      const plan = await planAgentAction({ apiKey, model: aiModel, userText: text, allowedCategories, lastShownList: lastShown });
      if (plan.type === 'chat') {
        bot.sendMessage(chatId, plan.chat.message);
        return;
      }
      if (plan.type === 'tool') {
        await executeToolPlan({ chatId, from, toolName: plan.tool.name, args: plan.tool.args, userText: text });
        return;
      }
    } catch (e) {
      debugLog('planner_error', { message: String(e?.message || e) });
      // Fall back to legacy AI intent parser below.
    }

    const priorTaskDraft = existingDraft?.task || null;

    // Allowed categories come from Notion Tags options and exclude Deprecated.
    // AI must choose exactly one of them, otherwise we will fallback to Inbox.
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
        allowedCategories,
      });

      debugLog('ai_result', { type: normalized.type });

      if (normalized.type === 'question') {
        bot.sendMessage(chatId, normalized.question.answer);
        return;
      }

      const draftId = existingDraft?.id || makeId(`${chatId}:${Date.now()}:${normalized.task.title}`);

      // Enforce category constraints and default to Inbox if uncertain.
      const task = normalized.task;
      const rawAiTag = Array.isArray(task.tags) && task.tags.length ? task.tags[0] : null;
      const normalizedTag = normalizeCategoryInput(rawAiTag);

      // Case-insensitive match against allowed categories, but keep canonical casing from Notion.
      const allowedMap = new Map(allowedCategories.map((c) => [String(c).trim().toLowerCase(), c]));
      const canonical = normalizedTag ? allowedMap.get(String(normalizedTag).trim().toLowerCase()) : null;
      const finalTag = canonical || 'Inbox';
      task.tags = [finalTag];

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

    if (action && action.startsWith('tool:')) {
      const [, act, actionId] = action.split(':');
      const pending = pendingToolActionByChatId.get(chatId) || null;

      if (!pending || !pending.id || pending.id !== actionId) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Подтверждение устарело. Повтори команду.');
        return;
      }

      if (act === 'cancel') {
        pendingToolActionByChatId.delete(chatId);
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Ок, отменил.');
        return;
      }

      if (act === 'confirm') {
        const kind = pending.kind;
        const payload = pending.payload;
        pendingToolActionByChatId.delete(chatId);
        bot.answerCallbackQuery(query.id);
        try {
          if (kind === 'notion.mark_done') {
            await tasksRepo.markDone({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Пометил как выполнено.');
            return;
          }
          if (kind === 'notion.move_to_deprecated') {
            await tasksRepo.moveToDeprecated({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Перенес в Deprecated.');
            return;
          }
          if (kind === 'notion.update_task') {
            await tasksRepo.updateTask({ pageId: payload.pageId, ...payload.patch });
            bot.sendMessage(chatId, 'Готово. Обновил задачу.');
            return;
          }
          if (kind === 'notion.append_description') {
            await tasksRepo.appendDescription({ pageId: payload.pageId, text: payload.text });
            bot.sendMessage(chatId, 'Готово. Добавил описание.');
            return;
          }
          if (kind === 'notion.create_task') {
            const created = await tasksRepo.createTask(payload);
            if (payload.description) await tasksRepo.appendDescription({ pageId: created.id, text: payload.description });
            bot.sendMessage(chatId, `Готово. Создал задачу: ${created.title}`);
            return;
          }
          if (kind === 'notion.create_idea') {
            const created = await ideasRepo.createIdea(payload);
            if (payload.description) await ideasRepo.appendDescription({ pageId: created.id, text: payload.description });
            bot.sendMessage(chatId, `Готово. Добавил идею: ${created.title}`);
            return;
          }
          if (kind === 'notion.create_social_post') {
            const created = await socialRepo.createPost(payload);
            if (payload.description) await socialRepo.appendDescription({ pageId: created.id, text: payload.description });
            bot.sendMessage(chatId, `Готово. Добавил пост: ${created.title}`);
            return;
          }
          if (kind === 'notion.update_idea') {
            await ideasRepo.updateIdea({ pageId: payload.pageId, ...payload.patch });
            bot.sendMessage(chatId, 'Готово. Обновил идею.');
            return;
          }
          if (kind === 'notion.archive_idea') {
            await ideasRepo.archiveIdea({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Архивировал идею.');
            return;
          }
          if (kind === 'notion.update_social_post') {
            await socialRepo.updatePost({ pageId: payload.pageId, ...payload.patch });
            bot.sendMessage(chatId, 'Готово. Обновил пост.');
            return;
          }
          if (kind === 'notion.archive_social_post') {
            await socialRepo.archivePost({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Архивировал пост.');
            return;
          }
          bot.sendMessage(chatId, 'Неизвестная операция.');
        } catch {
          bot.sendMessage(chatId, 'Не получилось выполнить действие в Notion.');
        }
        return;
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action && action.startsWith('pick:')) {
      const suffix = action.split(':')[1] || '';
      if (suffix === 'cancel') {
        pendingToolActionByChatId.delete(chatId);
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Ок, отменил.');
        return;
      }

      const idx = Number(suffix);
      const pending = pendingToolActionByChatId.get(chatId);
      if (!pending || !Number.isFinite(idx)) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Выбор устарел. Попробуй еще раз.');
        return;
      }

      const items = pending.payload?._candidates || [];
      const chosen = items.find((x) => x.index === idx);
      if (!chosen) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Не нашел выбранный пункт. Попробуй еще раз.');
        return;
      }

      // Replace pending action with resolved pageId and ask for confirmation.
      const kind = pending.kind;
      const actionId = makeId(`${chatId}:${Date.now()}:${kind}:${chosen.id}`);
      pendingToolActionByChatId.set(chatId, { id: actionId, kind, payload: { ...pending.payload, pageId: chosen.id }, createdAt: Date.now() });

      bot.answerCallbackQuery(query.id);

      if (kind === 'notion.mark_done') {
        bot.sendMessage(chatId, `Пометить выполнено: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.move_to_deprecated') {
        bot.sendMessage(chatId, `Перенести в Deprecated: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.update_task') {
        bot.sendMessage(chatId, `Обновить задачу: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.append_description') {
        bot.sendMessage(chatId, `Добавить описание к: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.update_idea') {
        bot.sendMessage(chatId, `Обновить идею: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.archive_idea') {
        bot.sendMessage(chatId, `Архивировать идею: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.update_social_post') {
        bot.sendMessage(chatId, `Обновить пост: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.archive_social_post') {
        bot.sendMessage(chatId, `Архивировать пост: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }

      bot.sendMessage(chatId, 'Ок. Подтверди действие.', buildToolConfirmKeyboard({ actionId }));
      return;
    }

    if (action && action.startsWith('plat:')) {
      const [, actionId, idxRaw] = action.split(':');
      const idx = Number(idxRaw);
      const pending = pendingToolActionByChatId.get(chatId) || null;
      if (!pending || pending.id !== actionId || !String(pending.kind || '').startsWith('social.pick_platform')) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Выбор устарел. Попробуй еще раз.');
        return;
      }
      const platforms = pending.payload?.platforms || [];
      if (!Number.isFinite(idx) || idx < 0 || idx >= platforms.length) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Не понял выбранную платформу.');
        return;
      }
      const platformName = platforms[idx];
      const draft = pending.payload?.draft || {};
      const kind = pending.kind;
      pendingToolActionByChatId.delete(chatId);
      bot.answerCallbackQuery(query.id);

      if (kind === 'social.pick_platform_list') {
        await executeToolPlan({
          chatId,
          from: null,
          toolName: 'notion.list_social_posts',
          args: { ...draft, platform: platformName },
          userText: `platform_selected:${platformName}`,
        });
        return;
      }

      if (kind === 'social.pick_platform_update') {
        await executeToolPlan({
          chatId,
          from: null,
          toolName: 'notion.update_social_post',
          args: { ...draft, platform: platformName },
          userText: `platform_selected:${platformName}`,
        });
        return;
      }

      // Default: create (will dedup and possibly ask to confirm).
      await executeToolPlan({
        chatId,
        from: null,
        toolName: 'notion.create_social_post',
        args: { ...draft, platform: platformName },
        userText: `platform_selected:${platformName}`,
      });
      return;
    }

    if (action && action.startsWith('ai:')) {
      const [, act, draftId] = action.split(':');
      if (act === 'cancel') {
        cancelAiDraft({ chatId, draftId, queryId: query.id });
        return;
      }

      if (act === 'confirm') {
        await confirmAiDraft({ chatId, draftId, queryId: query.id });
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

      const normalizedCategory = normalizeCategoryInput(category);
      if (!normalizedCategory) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Эта категория недоступна.');
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
        debugLog('notion_call', { op: 'createTask', tag: normalizedCategory, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: normalizedCategory, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${normalizedCategory}\".`);
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

    if (action.startsWith('priority:')) {
      // priority:{taskId}:{category}:{pmd}:{priorityOption}
      const [, taskId, category, pmdRaw, priorityOpt] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      waitingFor.priority.delete(chatId);
      clearTimer(chatId);

      const finalPriority = String(priorityOpt).toLowerCase() === 'skip' ? null : priorityOpt;

      if (DATE_CATEGORIES.includes(category)) {
        waitingFor.date.add(chatId);
        const kb = buildDateKeyboard({ taskId, category, pmd: null, priority: finalPriority });
        bot.sendMessage(chatId, `Please select a due date for task \"${truncatedTask}\":`, kb);

        timers.set(
          chatId,
          setTimeout(async () => {
            if (!waitingFor.date.has(chatId)) return;
            waitingFor.date.delete(chatId);
            try {
              debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
              await notionRepo.createTask({ title: fullTask, tag: category, priority: finalPriority, status: 'Idle' });
              debugLog('notion_result', { op: 'createTask', ok: true });
              bot.sendMessage(chatId, `Date selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with Priority: ${finalPriority || 'not set'}.`);
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
        await notionRepo.createTask({ title: fullTask, tag: category, priority: finalPriority, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with Priority: ${finalPriority || 'not set'}.`);
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

      const priority = prioRaw === 'null' ? null : prioRaw;
      const dueDate = String(dateString).toLowerCase() === 'skip' ? null : dateString;

      try {
        debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: category, priority, dueDate, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with Priority: ${priority || 'not set'}, Due Date: ${dueDate || 'not set'}.`);
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


