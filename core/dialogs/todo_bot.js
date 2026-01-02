const crypto = require('crypto');
const moment = require('moment');
const { aiAnalyzeMessage } = require('../ai/todo_intent');
const todoBotPkg = require('../../apps/todo_bot/package.json');
const { planAgentAction } = require('../ai/agent_planner');
const { classifyConfirmIntent } = require('../ai/confirm_intent');
const { PreferencesRepo } = require('../connectors/postgres/preferences_repo');
const { ChatMemoryRepo } = require('../connectors/postgres/chat_memory_repo');
const { MemorySuggestionsRepo } = require('../connectors/postgres/memory_suggestions_repo');
const { WorkContextRepo } = require('../connectors/postgres/work_context_repo');
const { createToolExecutor } = require('./todo_bot_executor');
const { createCallbackQueryHandler } = require('./todo_bot_callbacks');
const { handleVoiceMessage } = require('./todo_bot_voice');
const { sanitizeErrorForLog, sanitizeForLog, sanitizeTextForStorage } = require('../runtime/log_sanitize');
const { extractPreferences, isLikelyPreferenceText } = require('../ai/preference_extractor');
const { createChatSecurity, formatChatLine } = require('../runtime/chat_security');

function isDebugEnabled() {
  const v = String(process.env.TG_DEBUG || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isAiEnabled() {
  const v = String(process.env.TG_AI || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isPreferenceExtractorEnabled() {
  const v = String(process.env.TG_PREF_EXTRACTOR_ENABLED || '').trim().toLowerCase();
  if (!v) return true;
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

function getWorkContextMode() {
  // off | auto | always
  const v = String(process.env.TG_WORK_CONTEXT_MODE || '').trim().toLowerCase();
  if (!v) return 'auto';
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return 'off';
  if (v === 'always') return 'always';
  return 'auto';
}

function debugLog(event, fields = {}) {
  if (!isDebugEnabled()) return;
  // Never log secrets. Keep payloads small and mostly metadata.
  const safeFields = {};
  for (const [k, v] of Object.entries(fields || {})) {
    safeFields[k] = sanitizeForLog(v);
  }
  // eslint-disable-next-line no-console
  console.log(`[tg_debug] ${event}`, safeFields);
}

function isChatMemoryEnabled() {
  const v = String(process.env.TG_CHAT_MEMORY_ENABLED || '').trim().toLowerCase();
  if (!v) return true;
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

function wrapTelegramBotWithChatMemory({ bot, chatMemoryRepo }) {
  return new Proxy(bot, {
    get(target, prop) {
      const orig = target[prop];
      if (prop === 'sendMessage' && typeof orig === 'function') {
        return (chatId, text, options) => {
          const res = orig.call(target, chatId, text, options);
          Promise.resolve(res)
            .then((msg) => {
              const safeText = sanitizeTextForStorage(String(text || ''));
              if (!safeText.trim()) return;
              return chatMemoryRepo.appendMessage({
                chatId,
                role: 'assistant',
                text: safeText,
                tgMessageId: msg?.message_id || null,
              });
            })
            .catch(() => {});
          return res;
        };
      }
      // Preserve `this` binding for methods.
      if (typeof orig === 'function') return orig.bind(target);
      return orig;
    },
  });
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
  // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
  // Order matters: "послезавтра" contains "завтра".
  if (/(day\s+after\s+tomorrow)/.test(t) || /(послезавтра)/.test(t)) return yyyyMmDdInTz({ tz, date: new Date(Date.now() + 2 * dayMs) });
  if (/(tomorrow)/.test(t) || /(завтра)/.test(t)) return yyyyMmDdInTz({ tz, date: new Date(Date.now() + dayMs) });
  if (/(today)/.test(t) || /(сегодня)/.test(t)) return yyyyMmDdInTz({ tz, date: new Date() });

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

function normalizeDueDateInputLocal({ dueDate, tz }) {
  if (dueDate === null || dueDate === undefined) return dueDate;
  const raw = String(dueDate || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}([tT ].*)?$/.test(raw)) return raw;
  const inferred = inferDateFromText({ userText: raw, tz });
  if (inferred) return inferred;
  return null;
}

function addDaysToYyyyMmDd(dateStr, days) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const base = Date.UTC(y, mo - 1, d);
  const next = new Date(base + Number(days || 0) * 24 * 60 * 60 * 1000);
  const yyyy = String(next.getUTCFullYear()).padStart(4, '0');
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
  const hasDoneWords = /(выполненн|выполнен|завершенн|завершен|сделанн|сделан|done|completed)/.test(t);
  const hasNegation = /(не\s*выполн|невыполн|не\s*заверш|незаверш|не\s*сделан|несделан)/.test(t);
  const hasIncludeWords = /(включая|с\s+учет(ом)?|с\s+выполненными|с\s+завершенными|все\s+.*выполн)/.test(t);

  let doneMode = 'exclude';
  if (hasDoneWords && !hasNegation) {
    doneMode = hasIncludeWords ? 'include' : 'only';
  }

  // "today" list intent: due today + inbox (alias).
  // Prefer "на сегодня" phrasing to avoid collision with "Today=Inbox" alias.
  const isTodayPreset = /(на\s+сегодня)/.test(t) || /(сегодняшн)/.test(t) || /(задач(и|а)\s+на\s+сегодня)/.test(t);
  if (isTodayPreset) return { preset: 'today', tag: null, doneMode };

  // Category synonyms (RU -> Notion Tag)
  if (/(инбокс)/.test(t) || /(входящ)/.test(t) || /(^|\W)today($|\W)/.test(t)) return { preset: null, tag: 'Inbox', doneMode };
  if (/(домашн)/.test(t) || /(дом)/.test(t)) return { preset: null, tag: 'Home', doneMode };
  if (/(рабоч)/.test(t) || /(работа)/.test(t)) return { preset: null, tag: 'Work', doneMode };

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

function clampRating1to5(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return Math.max(1, Math.min(5, rounded));
}

function hasNonEmptyOptionInput(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((x) => String(x || '').trim());
  return Boolean(String(value || '').trim());
}

function inferJournalTypeFromText({ userText }) {
  const t = String(userText || '').toLowerCase();
  // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
  if (/(итог)/.test(t) || /(итоги)/.test(t) || /(итог\s+дня)/.test(t)) return 'Итог дня';
  if (/(хорош(ий|о)|плох(ой|о)|прекрасн(ый|о)|тяжел(ый|о))\s+д(е|ё)н(ь|я)/.test(t)) return 'Итог дня';
  if (/(как\s+прош(е|ё)л\s+д(е|ё)н(ь|я)|д(е|ё)н(ь|я)\s+перед)/.test(t)) return 'Итог дня';
  if (/(рефлекс)/.test(t)) return 'Рефлексия';
  if (/(событ)/.test(t)) return 'Событие';
  if (/(идея)/.test(t)) return 'Идея';
  return 'Мысль';
}

function inferJournalTopicsFromText({ userText }) {
  const t = String(userText || '').toLowerCase();
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };
  // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
  if (/(нов(ый|ого)\s+год|рождеств|праздник)/.test(t)) push('Праздники');
  if (/(д(е|ё)н(ь|я)|сегодня|вчера|завтра|итог)/.test(t)) push('Итоги дня');
  if (/(работ)/.test(t) || /(проект)/.test(t) || /(заказ)/.test(t)) push('Работа');
  if (/(семь)/.test(t) || /(дет)/.test(t) || /(родител)/.test(t)) push('Семья');
  if (/(встреч)/.test(t) || /(созвон)/.test(t)) push('Встречи');
  if (/(здоров)/.test(t) || /(сон)/.test(t) || /(трен)/.test(t)) push('Здоровье');
  if (/(отношен)/.test(t)) push('Отношения');
  if (/(контент)/.test(t) || /(пост)/.test(t) || /(соцсет)/.test(t)) push('Контент');
  if (/(деньг)/.test(t) || /(финанс)/.test(t)) push('Финансы');
  if (/(дорог|поездк|путеше)/.test(t)) push('Дорога');
  if (!out.length) push('Итоги дня');
  return out.slice(0, 3);
}

function inferJournalContextFromText({ userText }) {
  const t = String(userText || '').toLowerCase();
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };
  // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
  if (/(дом)/.test(t)) push('дом');
  if (/(офис)/.test(t)) push('офис');
  if (/(дорог)/.test(t) || /(путь)/.test(t)) push('дорога');
  if (/(встреч)/.test(t) || /(созвон)/.test(t)) push('встречи');
  if (/(один)/.test(t)) push('один');
  if (/(семь)/.test(t)) push('семья');
  if (!out.length) push('не указано');
  return out.slice(0, 2);
}

function normalizeTitleKeyLocal(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .trim();
}

function looksLikeTaskTagsList(value, taskTags) {
  const tags = Array.isArray(taskTags) ? taskTags.filter(Boolean) : [];
  if (!tags.length) return false;
  const set = new Set(tags.map((x) => normalizeOptionKey(x)));
  const arr = Array.isArray(value) ? value : [value];
  const cleaned = arr.map((x) => String(x || '').trim()).filter(Boolean);
  if (cleaned.length < 3) return false;
  const matches = cleaned.filter((x) => set.has(normalizeOptionKey(x))).length;
  return matches / cleaned.length >= 0.6;
}

function inferMoodEnergyFromText({ userText }) {
  const t = String(userText || '').toLowerCase();
  let mood = 3;
  let energy = 3;

  // Mood (positive/negative)
  // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
  if (/(супер|класс|отличн|рад|счастлив|доволен|хорош(о|ий)|круто|кайф)/.test(t)) mood = 4;
  if (/(очень\s+рад|восторг|счастье|безумно\s+рад)/.test(t)) mood = 5;
  if (/(плох(о|ой)|грустн|тоск|печал|злюсь|раздраж|тревож|страшн|депресс)/.test(t)) mood = 2;
  if (/(ужасн|пиздец|крайне\s+плохо|паник)/.test(t)) mood = 1;

  // Energy (high/low)
  if (/(энерг|бодр|заряжен|полон\s+сил|высокая\s+энерг)/.test(t)) energy = 4;
  if (/(очень\s+энерг|максимум\s+энерг|на\s+подъеме)/.test(t)) energy = 5;
  if (/(устал|выгор|нет\s+сил|сонн|низк(ая|ой)\s+энерг|разбит)/.test(t)) energy = 2;
  if (/(совсем\s+нет\s+сил|еле\s+жив|очень\s+устал)/.test(t)) energy = 1;

  return { mood: clampRating1to5(mood), energy: clampRating1to5(energy) };
}

function isJournalRelatedText(text) {
  const t = String(text || '').toLowerCase();
  // Do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
  if (/(дневник|journal)/.test(t)) return true;
  // Follow-up: if we recently showed journal entries and the user refers to "запись", treat as journal context.
  if (/запис(ь|и|ю|ей|ям|ях)/.test(t)) return true;
  return false;
}

function isJournalListIntent(text) {
  const t = String(text || '').toLowerCase();
  return /(покажи|список|выведи|лист|list)/.test(t) && /(дневник|journal|запис(ь|и))/i.test(t);
}

function isJournalArchiveIntent(text) {
  const t = String(text || '').toLowerCase();
  return /(удали|удалить|архив|archive)/.test(t) && /(дневник|journal|запис(ь|и))/i.test(t);
}

function isJournalCreateIntent(text) {
  const t = String(text || '').toLowerCase();
  return /(добав|созда|нов(ую|ая)|запиш(и|у)|сделай\s+запись)/.test(t) && /(дневник|journal|запис(ь|и))/i.test(t);
}

function isJournalUpdateIntent(text) {
  const t = String(text || '').toLowerCase();
  // Include voice-style confirmations like "дополню", and do not rely on word boundaries for Cyrillic.
  const hasUpdate = /(обнов|заполн|перезаполн|простав|допол(ни|ню|нить)|исправ|категор)/.test(t);
  const hasCreate = /(добав|созда|нов(ую|ая)|запиш(и|у)|сделай\s+запись)/.test(t);
  return hasUpdate && !hasCreate && /(дневник|journal|запис(ь|и))/i.test(t);
}

function isEmptyPatchObject(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  return !Object.values(p).some((v) => v !== undefined);
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

async function registerTodoBot({ bot, tasksRepo, ideasRepo, socialRepo, journalRepo, databaseIds, pgPool = null, botMode = 'tests' }) {
  debugLog('bot_init', { databaseIds });
  const { tags: categoryOptions, priority: priorityOptions } = await tasksRepo.getOptions();
  const remindersRepo = pgPool ? new RemindersRepo({ pool: pgPool }) : null;
  const preferencesRepo = pgPool ? new PreferencesRepo({ pool: pgPool }) : null;
  const memorySuggestionsRepo = pgPool ? new MemorySuggestionsRepo({ pool: pgPool }) : null;
  const workCtxRepo = pgPool ? new WorkContextRepo({ pool: pgPool }) : null;
  let chatMemoryRepo = null;
  if (pgPool && isChatMemoryEnabled()) {
    const repo = new ChatMemoryRepo({ pool: pgPool });
    try {
      // If tables are missing, disable chat memory gracefully (no crashes).
      await pgPool.query('SELECT 1 FROM chat_messages LIMIT 1');
      chatMemoryRepo = repo;
      bot = wrapTelegramBotWithChatMemory({ bot, chatMemoryRepo });
      debugLog('chat_memory_enabled', { ok: true });
    } catch (e) {
      chatMemoryRepo = null;
      debugLog('chat_memory_disabled', { ok: false, reason: 'pg_or_tables_missing', message: String(e?.message || e) });
    }
  }

  const chatSecurity = createChatSecurity({ bot, pgPool });
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
  const lastShownListByChatId = new Map(); // chatId -> [{ index, id, title }] (tasks)
  const lastShownIdeasListByChatId = new Map(); // chatId -> [{ index, id, title }] (ideas)
  const lastShownSocialListByChatId = new Map(); // chatId -> [{ index, id, title }] (social posts)
  const lastShownJournalListByChatId = new Map(); // chatId -> [{ index, id, title }] (journal)
  const tz = process.env.TG_TZ || 'Europe/Moscow';
  const aiModel = process.env.TG_AI_MODEL || 'gpt-4.1';
  const PRIORITY_SET = new Set(PRIORITY_OPTIONS.filter((p) => p && p !== 'skip'));
  const memoryCacheByChatId = new Map(); // chatId -> { summary, ts }

  function buildMemorySummaryFromRows(rows) {
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) return null;
    const lines = [];
    for (const p of items.slice(0, 20)) {
      const key = String(p.pref_key || '').trim();
      if (!key) continue;
      const val = String(p.value_human || '').trim();
      if (val) lines.push(`- ${key}: ${val}`);
      else lines.push(`- ${key}`);
    }
    return lines.length ? lines.join('\n') : null;
  }

  async function getMemorySummaryForChat(chatId) {
    if (!preferencesRepo) return null;
    const cached = memoryCacheByChatId.get(chatId);
    if (cached && Date.now() - cached.ts < 60_000) return cached.summary;

    try {
      const rows = await preferencesRepo.listPreferencesForChat({ chatId, activeOnly: true });
      const summary = buildMemorySummaryFromRows(rows);
      memoryCacheByChatId.set(chatId, { summary, ts: Date.now() });
      return summary;
    } catch {
      return null;
    }
  }

  function formatChatHistoryForPlanner(rows) {
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) return '';
    const lines = [];
    for (const r of items.slice(-30)) {
      const role = String(r?.role || '').trim() || 'unknown';
      const text = oneLinePreview(String(r?.text || ''), 220);
      if (!text) continue;
      lines.push(`${role}: ${text}`);
    }
    return lines.join('\n');
  }

  async function getChatMemoryContextForChat(chatId) {
    if (!chatMemoryRepo) return { chatSummary: null, chatHistory: null };
    try {
      const lastN = Math.min(200, Math.max(1, Number(process.env.TG_CHAT_MEMORY_LAST_N || 50)));
      const [sumRow, rows] = await Promise.all([
        chatMemoryRepo.getSummary({ chatId }),
        chatMemoryRepo.listLastN({ chatId, limit: lastN }),
      ]);
      const chatSummary = sumRow?.summary ? String(sumRow.summary).trim() : null;
      const chatHistory = formatChatHistoryForPlanner(rows);
      return {
        chatSummary: chatSummary || null,
        chatHistory: chatHistory || null,
      };
    } catch {
      return { chatSummary: null, chatHistory: null };
    }
  }

  function shouldInjectWorkContext(userText) {
    const mode = getWorkContextMode();
    if (mode === 'off') return false;
    if (mode === 'always') return true;

    const t = String(userText || '').toLowerCase();
    if (!t.trim()) return false;

    // Heuristic: inject only for "discussion/analysis/planning" messages, not for direct CRUD commands.
    const isCrudish =
      /(добавь|создай|удали|перенеси|переименуй|пометь|сделай|выполни|запланируй|покажи|список|лист|today|\/(start|today|list|add|reminders_on|reminders_off))/i.test(
        t
      );
    if (isCrudish) return false;

    const isDiscussion =
      /(что\s+мне\s+делать|как\s+лучше|какой\s+план|какие\s+приоритеты|на\s+что\s+фокус|составь\s+план|распланируй|дай\s+совет|оцен(и|ка)|проанализируй|подскажи|что\s+важнее)/i.test(
        t
      );
    if (isDiscussion) return true;

    // If the message is long enough, it is likely a discussion.
    if (t.length >= 220) return true;

    return false;
  }

  async function getWorkContextForChat(chatId) {
    if (!workCtxRepo) return null;
    try {
      await pgPool.query('SELECT 1 FROM work_context_cache LIMIT 1');
    } catch {
      return null;
    }
    try {
      const row = await workCtxRepo.getCache({ chatId, key: 'work_ctx' });
      const text = row?.payload?.text ? String(row.payload.text) : '';
      if (!text.trim()) return null;

      const maxAgeMin = Math.min(7 * 24 * 60, Math.max(5, Number(process.env.TG_WORK_CONTEXT_MAX_AGE_MIN || 720)));
      const updatedAt = row?.updated_at ? new Date(row.updated_at) : null;
      if (updatedAt && Number.isFinite(updatedAt.getTime())) {
        const ageMs = Date.now() - updatedAt.getTime();
        if (ageMs > maxAgeMin * 60_000) return null;
      }
      return text.trim();
    } catch {
      return null;
    }
  }

  function buildPreferenceSuggestionKeyboard({ suggestionId }) {
    const rows = [
      [
        { text: 'Сохранить', callback_data: `mem:accept:${suggestionId}`.slice(0, 64) },
        { text: 'Не сохранять', callback_data: `mem:reject:${suggestionId}`.slice(0, 64) },
      ],
    ];
    return { reply_markup: { inline_keyboard: rows } };
  }

  async function maybeSuggestPreferenceFromText({ chatId, userText, sourceMessageId }) {
    if (!isPreferenceExtractorEnabled()) return;
    if (!pgPool || !preferencesRepo || !memorySuggestionsRepo) return;
    if (!isAiEnabled()) return;
    if (!isLikelyPreferenceText(userText)) return;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    // Require chat memory context to be available only when configured; otherwise proceed with empty.
    const [memSum, chatCtx] = await Promise.all([getMemorySummaryForChat(chatId), getChatMemoryContextForChat(chatId)]);
    let candidates = [];
    try {
      candidates = await extractPreferences({
        apiKey,
        model: process.env.TG_PREF_EXTRACTOR_MODEL || process.env.TG_AI_MODEL || 'gpt-4.1-mini',
        userText,
        preferencesSummary: memSum || '',
        chatSummary: chatCtx?.chatSummary || '',
        chatHistory: chatCtx?.chatHistory || '',
      });
    } catch (e) {
      debugLog('pref_extractor_error', { chatId, message: String(e?.message || e) });
      return;
    }

    if (!candidates.length) return;

    // One suggestion at a time to avoid spam.
    const c = candidates[0];
    const candidate = {
      key: c.key,
      scope: c.scope || 'global',
      category: c.category || null,
      value_human: c.valueHuman,
      value_json: c.valueJson || {},
      confidence: c.confidence,
      reason: c.reason,
    };

    try {
      // Ensure table exists
      await pgPool.query('SELECT 1 FROM memory_suggestions LIMIT 1');
    } catch {
      return;
    }

    const row = await memorySuggestionsRepo.createPreferenceSuggestion({
      chatId,
      candidate,
      sourceMessageId: sourceMessageId || null,
    });
    if (!row?.id) return;

    const text = [
      'Похоже, это похоже на предпочтение.',
      `Сохранить?`,
      `- ${candidate.key}: ${oneLinePreview(candidate.value_human, 140)}`,
    ].join('\n');

    bot.sendMessage(chatId, text, buildPreferenceSuggestionKeyboard({ suggestionId: row.id }));
  }

  async function renderAndRememberJournalList({ chatId, entries, title }) {
    const shown = (entries || []).slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownJournalListByChatId.set(chatId, shown);

    const lines = [title, ''];
    if (!shown.length) {
      lines.push('(пусто)');
      bot.sendMessage(chatId, lines.join('\n'));
      return;
    }

    for (const it of (entries || []).slice(0, 20)) {
      if (!it || !it.title) continue;
      const date = it.date ? `${it.date} ` : '';
      const typeSuffix = it.type ? ` [${it.type}]` : '';
      const rating = [];
      if (typeof it.mood === 'number') rating.push(`M:${it.mood}`);
      if (typeof it.energy === 'number') rating.push(`E:${it.energy}`);
      const ratingSuffix = rating.length ? ` (${rating.join(' ')})` : '';
      lines.push(`- ${date}${it.title}${typeSuffix}${ratingSuffix}`);
    }
    bot.sendMessage(chatId, lines.join('\n'));
  }

  async function renderAndRememberIdeasList({ chatId, ideas, title }) {
    const shown = (ideas || []).slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownIdeasListByChatId.set(chatId, shown);

    const lines = [title, ''];
    if (!shown.length) {
      lines.push('(пусто)');
      bot.sendMessage(chatId, lines.join('\n'));
      return;
    }

    for (const it of shown) {
      lines.push(`${it.index}. ${it.title}`);
    }
    bot.sendMessage(chatId, lines.join('\n'));
  }

  async function renderAndRememberSocialList({ chatId, posts, title }) {
    const shown = (posts || []).slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownSocialListByChatId.set(chatId, shown);

    const lines = [title, ''];
    if (!shown.length) {
      lines.push('(пусто)');
      bot.sendMessage(chatId, lines.join('\n'));
      return;
    }

    const slice = (posts || []).slice(0, 20);
    for (let i = 0; i < slice.length; i++) {
      const it = slice[i];
      if (!it || !it.title) continue;
      const plats = Array.isArray(it.platform) && it.platform.length ? ` [${it.platform.join(', ')}]` : '';
      lines.push(`${i + 1}. ${it.title}${plats}`);
    }
    bot.sendMessage(chatId, lines.join('\n'));
  }

  function resolveJournalPageIdFromLastShown({ chatId, text }) {
    const shown = lastShownJournalListByChatId.get(chatId) || [];
    if (!shown.length) return null;

    // If only one item shown recently, treat any follow-up as referring to it.
    if (shown.length === 1) return shown[0].id;

    const t = String(text || '').toLowerCase();
    // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
    const wantsMostRecent = /(эта|этой|к\s+ней|у\s+не(е|ё)|единствен|одна|последн)/.test(t);
    if (wantsMostRecent) return shown[0].id;

    const key = normalizeTitleKeyLocal(text);
    if (!key) return null;
    for (const it of shown) {
      const titleKey = normalizeTitleKeyLocal(it.title);
      if (titleKey && key.includes(titleKey)) return it.id;
    }
    return null;
  }

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
    const dueDate = normalizeDueDateInputLocal({ dueDate: task.dueDate ?? null, tz });

    try {
      debugLog('notion_call', { op: 'createTask', tag, status: 'Idle' });
      await tasksRepo.createTask({
        title: task.title,
        tag,
        priority,
        dueDate,
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

  const { executeToolPlan } = createToolExecutor({
    bot,
    tasksRepo,
    ideasRepo,
    socialRepo,
    journalRepo,
    tz,
    pendingToolActionByChatId,
    lastShownListByChatId,
    lastShownIdeasListByChatId,
    lastShownSocialListByChatId,
    renderAndRememberList,
    renderAndRememberIdeasList,
    renderAndRememberSocialList,
    renderAndRememberJournalList,
    resolveJournalPageIdFromLastShown,
  });

  function clearTimer(chatId) {
    const t = timers.get(chatId);
    if (t) clearTimeout(t);
    timers.delete(chatId);
  }

  const handleStart = async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }
    const cmd = String(msg.text || '').trim();
    debugLog('incoming_command', { chatId, command: cmd || '/start', from: msg.from?.username || null });
    const opts = {
      reply_markup: {
        keyboard: [
          [{ text: '/today' }, { text: '/list' }, { text: '/addtask' }, { text: 'Start' }],
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
  };

  bot.onText(/\/start/, handleStart);
  bot.onText(/^Start$/i, handleStart);

  bot.onText(/\/reminders_on/, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }
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
    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }
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
    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }
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

  // Security admin commands (notify + sessions + revoke)
  bot.onText(/^\/sessions(?:\s+(\d+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const limit = match && match[1] ? Number(match[1]) : 20;
    const rows = await chatSecurity.listSessions({ limit });
    if (!rows.length) {
      bot.sendMessage(chatId, 'Список пуст.');
      return;
    }
    const lines = ['Известные чаты (sessions):', `backend: ${chatSecurity.backendName()}`, ''];
    for (const r of rows) {
      lines.push(`- ${formatChatLine(r)}`);
    }
    bot.sendMessage(chatId, lines.join('\n'));
  });

  bot.onText(/^\/security_status\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const rows = await chatSecurity.listSessions({ limit: 200 });
    const revokedCount = rows.filter((r) => Boolean(r.revoked)).length;
    bot.sendMessage(chatId, [`Security status:`, `- backend: ${chatSecurity.backendName()}`, `- known chats: ${rows.length}`, `- revoked: ${revokedCount}`].join('\n'));
  });

  bot.onText(/^\/revoke_here(?:\s+(.+))?\s*$/i, async (msg, match) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    const reason = match && match[1] ? String(match[1]).trim() : null;
    await chatSecurity.revokeChat({ actorChatId, targetChatId: actorChatId, reason });
    bot.sendMessage(actorChatId, 'Ок. Этот чат отключен (revoked).');
  });

  bot.onText(/^\/revoke\s+(\d+)(?:\s+(.+))?\s*$/i, async (msg, match) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    const targetChatId = Number(match[1]);
    const reason = match && match[2] ? String(match[2]).trim() : null;
    await chatSecurity.revokeChat({ actorChatId, targetChatId, reason });
    bot.sendMessage(actorChatId, `Ок. Отключил чат ${targetChatId}.`);
  });

  bot.onText(/^\/unrevoke\s+(\d+)\s*$/i, async (msg, match) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    const targetChatId = Number(match[1]);
    await chatSecurity.unrevokeChat({ actorChatId, targetChatId });
    bot.sendMessage(actorChatId, `Ок. Вернул доступ для чата ${targetChatId}.`);
  });

  bot.onText(/\/addtask/, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }
    debugLog('incoming_command', { chatId, command: '/addtask', from: msg.from?.username || null });
    pendingTask.set(chatId, { id: null, text: null });
    bot.sendMessage(chatId, 'Please enter your new task:');
  });

  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }
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
    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }
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

    await chatSecurity.touchFromMsg(msg);
    if (await chatSecurity.shouldBlockChat(chatId)) {
      await chatSecurity.maybeReplyRevoked(chatId);
      return;
    }

    // Chat memory: store incoming user message text (including commands).
    if (chatMemoryRepo && msg.text) {
      const safeText = sanitizeTextForStorage(String(msg.text || ''));
      if (safeText.trim()) {
        chatMemoryRepo
          .appendMessage({ chatId, role: 'user', text: safeText, tgMessageId: msg.message_id || null })
          .catch(() => {});
      }
    }

    // Preference extractor: run best-effort in background (do not block main flow).
    if (msg.text) {
      Promise.resolve()
        .then(() =>
          maybeSuggestPreferenceFromText({
            chatId,
            userText: String(msg.text || ''),
            sourceMessageId: msg.message_id || null,
          })
        )
        .catch(() => {});
    }

    // Ignore commands here (handled by onText handlers).
    if (msg.text && msg.text.startsWith('/')) return;

    // Voice pipeline (minimal v1): download -> ffmpeg -> STT -> planner/tools.
    if (msg.voice && msg.voice.file_id) {
      await handleVoiceMessage({
        bot,
        msg,
        chatId,
        from,
        aiModel,
        tz,
        notionCategories,
        lastShownListByChatId,
        lastShownIdeasListByChatId,
        lastShownSocialListByChatId,
        executeToolPlan,
        aiDraftByChatId,
        aiDraftById,
        getPlannerContext: async ({ userText } = {}) => {
          const [memorySummary, chatCtx] = await Promise.all([getMemorySummaryForChat(chatId), getChatMemoryContextForChat(chatId)]);
          const workContext = shouldInjectWorkContext(userText || '') ? await getWorkContextForChat(chatId) : null;
          return {
            memorySummary,
            chatSummary: chatCtx?.chatSummary || null,
            chatHistory: chatCtx?.chatHistory || null,
            workContext,
          };
        },
        appendUserTextToChatMemory: async ({ text, tgMessageId }) => {
          if (!chatMemoryRepo) return;
          const safeText = sanitizeTextForStorage(String(text || ''));
          if (!safeText.trim()) return;
          await chatMemoryRepo.appendMessage({ chatId, role: 'user', text: safeText, tgMessageId: tgMessageId || null });
        },
        maybeSuggestPreferenceFromText: async ({ chatId: cId, userText, sourceMessageId }) => {
          await maybeSuggestPreferenceFromText({
            chatId: cId,
            userText,
            sourceMessageId,
          });
        },
      });
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
            if (Array.isArray(payload._queueQueries) && payload._queueQueries.length) {
              const next = payload._queueQueries[0];
              const rest = payload._queueQueries.slice(1);
              await executeToolPlan({
                chatId,
                from,
                toolName: 'notion.move_to_deprecated',
                args: { queryText: next, _queueQueries: rest },
                userText: String(next || ''),
              });
            }
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
      const lastShownIdeas = lastShownIdeasListByChatId.get(chatId) || [];
      const lastShownSocial = lastShownSocialListByChatId.get(chatId) || [];
      const [memorySummary, chatCtx, workContext] = await Promise.all([
        getMemorySummaryForChat(chatId),
        getChatMemoryContextForChat(chatId),
        shouldInjectWorkContext(text) ? getWorkContextForChat(chatId) : null,
      ]);
      const plan = await planAgentAction({
        apiKey,
        model: aiModel,
        userText: text,
        allowedCategories,
        lastShownList: lastShown,
        lastShownIdeasList: lastShownIdeas,
        lastShownSocialList: lastShownSocial,
        tz,
        nowIso: new Date().toISOString(),
        memorySummary,
        chatSummary: chatCtx?.chatSummary || null,
        chatHistory: chatCtx?.chatHistory || null,
        workContext,
      });
      if (plan.type === 'chat') {
        // Guard: for Journal-related intents, do not let the model ask the user to provide fields.
        // Always route to tools and let deterministic code infer/fill missing fields.
        if (isJournalRelatedText(text)) {
          const toolName = isJournalListIntent(text)
            ? 'notion.list_journal_entries'
            : isJournalArchiveIntent(text)
              ? 'notion.archive_journal_entry'
              : isJournalCreateIntent(text)
                ? 'notion.create_journal_entry'
                : isJournalUpdateIntent(text)
                  ? 'notion.update_journal_entry'
                  : 'notion.create_journal_entry';

          const args =
            toolName === 'notion.create_journal_entry'
              ? { title: oneLinePreview(text, 64) || 'Запись', description: text }
              : toolName === 'notion.update_journal_entry'
                ? { queryText: null, autofill: true }
                : { queryText: null };

          await executeToolPlan({ chatId, from, toolName, args, userText: text });
          return;
        }

        bot.sendMessage(chatId, plan.chat.message);
        return;
      }
      if (plan.type === 'tool') {
        await executeToolPlan({ chatId, from, toolName: plan.tool.name, args: plan.tool.args, userText: text });
        return;
      }
    } catch (e) {
      debugLog('planner_error', { message: String(e?.message || e) });
      if (isJournalRelatedText(text)) {
        const toolName = isJournalListIntent(text)
          ? 'notion.list_journal_entries'
          : isJournalArchiveIntent(text)
            ? 'notion.archive_journal_entry'
            : isJournalCreateIntent(text)
              ? 'notion.create_journal_entry'
              : isJournalUpdateIntent(text)
                ? 'notion.update_journal_entry'
                : 'notion.create_journal_entry';

        const args =
          toolName === 'notion.create_journal_entry'
            ? { title: oneLinePreview(text, 64) || 'Запись', description: text }
            : toolName === 'notion.update_journal_entry'
              ? { queryText: null, autofill: true }
              : { queryText: null };

        await executeToolPlan({ chatId, from, toolName, args, userText: text });
        return;
      }
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

  const handleCallbackQuery = createCallbackQueryHandler({
    bot,
    tasksRepo,
    ideasRepo,
    socialRepo,
    journalRepo,
    pendingToolActionByChatId,
    executeToolPlan,
    confirmAiDraft,
    cancelAiDraft,
    clearTimer,
    timers,
    pendingTask,
    taskTextById,
    waitingFor,
    DATE_CATEGORIES,
    notionRepo,
    chatSecurity,
    pgPool,
  });
  bot.on('callback_query', handleCallbackQuery);

  bot.on('polling_error', (error) => {
    // Do not crash on transient errors.
    // eslint-disable-next-line no-console
    console.error('Polling error:', sanitizeErrorForLog(error));
    debugLog('polling_error', { code: error?.code || null, message: sanitizeForLog(String(error?.message || '')) });
    if (error.code === 'EFATAL') {
      setTimeout(() => {
        bot.stopPolling().then(() => bot.startPolling());
      }, 10_000);
    }
  });
}

module.exports = { registerTodoBot };


