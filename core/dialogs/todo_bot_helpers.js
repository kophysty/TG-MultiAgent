const crypto = require('crypto');
const moment = require('moment');
const { sanitizeForLog } = require('../runtime/log_sanitize');

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
  const safeFields = {};
  for (const [k, v] of Object.entries(fields || {})) {
    safeFields[k] = sanitizeForLog(v);
  }
  // eslint-disable-next-line no-console
  console.log(`[tg_debug] ${event}`, safeFields);
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

function normalizeDueDateInput({ dueDate, tz }) {
  if (dueDate === null || dueDate === undefined) return dueDate;
  const raw = String(dueDate || '').trim();
  if (!raw) return null;

  // Keep valid ISO date or datetime as-is (Notion accepts both).
  if (/^\d{4}-\d{2}-\d{2}([tT ].*)?$/.test(raw)) return raw;

  const inferred = inferDateFromText({ userText: raw, tz });
  if (inferred) return inferred;

  // Unknown non-ISO date token: drop it to avoid Notion validation error.
  return null;
}

function inferTimeFromText({ userText }) {
  const t = String(userText || '').toLowerCase();
  if (!t) return null;

  // Examples:
  // - "сегодня в 15:00"
  // - "на 15.00"
  // - "к 9"
  // - "в 9 утра"
  // - "в 15 30"
  const m =
    t.match(/(?:^|\s)(?:в|на|к)\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?(?:\s|$)/) ||
    t.match(/(?:^|\s)(?:в|на|к)\s*(\d{1,2})\s+(\d{2})(?:\s|$)/) ||
    t.match(/(?:^|\s)(?:в|на|к)\s*(\d{1,2})\s*(?:час|ч)(?:а|ов)?(?:\s|$)/);

  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] !== undefined ? Number(m[2]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;

  let hour = hh;
  const tail = t.slice(Math.max(0, m.index || 0), Math.min(t.length, (m.index || 0) + m[0].length + 16));
  const hasMorning = /(утра)/.test(tail) || /(утра)/.test(t);
  const hasEvening = /(вечер|вечера)/.test(tail) || /(вечер|вечера)/.test(t);
  const hasDay = /(дня)/.test(tail) || /(дня)/.test(t);
  const hasNight = /(ноч|ночи)/.test(tail) || /(ноч|ночи)/.test(t);

  if (hasEvening && hour < 12) hour += 12;
  if (hasDay && hour < 12) hour += 12;
  if (hasNight && hour === 12) hour = 0;
  if (hasMorning && hour === 12) hour = 0;

  return { hour, minute: mm };
}

function formatUtcOffsetFromMinutes(offsetMinutes) {
  const mins = Number(offsetMinutes);
  if (!Number.isFinite(mins)) return 'Z';
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function getTzOffsetMinutesAtUtcInstant({ tz, utcDate }) {
  const d = utcDate instanceof Date ? utcDate : new Date(utcDate);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second)
  );
  return Math.round((asUtc - d.getTime()) / 60000);
}

function buildIsoDateTimeInTz({ dateYyyyMmDd, hour, minute, tz }) {
  const m = String(dateYyyyMmDd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(hour);
  const mm = Number(minute);
  if (![y, mo, d, hh, mm].every((x) => Number.isFinite(x))) return null;

  // Iteratively find the correct offset for the given local time in tz (handles DST).
  const localAsUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let offset = getTzOffsetMinutesAtUtcInstant({ tz, utcDate: new Date(localAsUtc) });
  let utcMillis = localAsUtc - offset * 60000;
  offset = getTzOffsetMinutesAtUtcInstant({ tz, utcDate: new Date(utcMillis) });
  utcMillis = localAsUtc - offset * 60000;
  offset = getTzOffsetMinutesAtUtcInstant({ tz, utcDate: new Date(utcMillis) });

  const off = formatUtcOffsetFromMinutes(offset);
  const H = String(hh).padStart(2, '0');
  const M = String(mm).padStart(2, '0');
  return `${m[1]}-${m[2]}-${m[3]}T${H}:${M}:00${off}`;
}

function inferDueDateFromUserText({ userText, tz }) {
  const date = inferDateFromText({ userText, tz });
  const time = inferTimeFromText({ userText });
  if (!date && !time) return null;

  const dateYyyyMmDd = date || yyyyMmDdInTz({ tz, date: new Date() });
  if (!time) return dateYyyyMmDd;
  return buildIsoDateTimeInTz({ dateYyyyMmDd, hour: time.hour, minute: time.minute, tz });
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

  // Preset hints:
  // - today: special behavior (today + Inbox alias), but tag may still be present (e.g. "рабочие задачи на сегодня")
  // - tomorrow / day_after_tomorrow: plain dueDate filter
  // Order matters: "послезавтра" contains "завтра".
  let preset = null;
  const isTodayPreset = /(на\s+сегодня)/.test(t) || /(сегодняшн)/.test(t) || /(задач(и|а)\s+на\s+сегодня)/.test(t);
  const isDayAfterTomorrowPreset =
    /(на\s+послезавтра)/.test(t) ||
    /(послезавтра)/.test(t) ||
    /(day\s+after\s+tomorrow)/.test(t);
  const isTomorrowPreset =
    /(на\s+завтра)/.test(t) ||
    /(завтрашн)/.test(t) ||
    /(задач(и|а)\s+на\s+завтра)/.test(t) ||
    /(tomorrow)/.test(t);
  if (isTodayPreset) preset = 'today';
  else if (isDayAfterTomorrowPreset) preset = 'day_after_tomorrow';
  else if (isTomorrowPreset) preset = 'tomorrow';

  // Category synonyms (RU -> Notion Tag)
  let tag = null;
  if (/(инбокс)/.test(t) || /(входящ)/.test(t) || /(^|\W)today($|\W)/.test(t)) tag = 'Inbox';
  else if (/(домашн)/.test(t) || /(дом)/.test(t)) tag = 'Home';
  else if (/(рабоч)/.test(t) || /(работа)/.test(t)) tag = 'Work';

  return { preset, tag, doneMode };
}

function inferListDueDateFromText({ userText, tz }) {
  const t = String(userText || '').trim().toLowerCase();
  if (!t) return null;

  // First: reuse base inference for today/tomorrow/poslezavtra and explicit numeric formats.
  const direct = inferDateFromText({ userText, tz });
  if (direct) return direct;

  // Month names (RU) - match by stem.
  const months = [
    [/январ/i, 1],
    [/феврал/i, 2],
    [/март/i, 3],
    [/апрел/i, 4],
    [/ма[йя]/i, 5],
    [/июн/i, 6],
    [/июл/i, 7],
    [/август/i, 8],
    [/сентябр/i, 9],
    [/октябр/i, 10],
    [/ноябр/i, 11],
    [/декабр/i, 12],
  ];

  const nowYmd = yyyyMmDdInTz({ tz });
  const [nowY, nowM, nowD] = nowYmd.split('-').map((x) => Number(x));
  if (![nowY, nowM, nowD].every((x) => Number.isFinite(x))) return null;

  // Helper: pad 2
  const pad2 = (n) => String(n).padStart(2, '0');

  // 1) Numeric day-of-month patterns: "на 8", "на 8-е", "на 8 число", but avoid times like "на 15:00"
  let day = null;
  let month = null;
  let year = null;

  const num = t.match(/(?:^|\s)на\s+(\d{1,2})(?!\s*[:.]\s*\d{2})(?:\s*[-–]?\s*(?:е|ое|го|ого))?(?:\s+(?:числ(о|а)|день|дня))?/i);
  if (num && num[1]) {
    const n = Number(num[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 31) day = n;
  }

  // 2) RU ordinal words: "на восьмое", "на двадцать первое"
  if (!day) {
    const ord = [
      [/перв/i, 1],
      [/втор/i, 2],
      [/трет/i, 3],
      [/четверт/i, 4],
      [/пят/i, 5],
      [/шест/i, 6],
      [/седьм/i, 7],
      [/восьм/i, 8],
      [/девят/i, 9],
      [/десят/i, 10],
      [/одиннадцат/i, 11],
      [/двенадцат/i, 12],
      [/тринадцат/i, 13],
      [/четырнадцат/i, 14],
      [/пятнадцат/i, 15],
      [/шестнадцат/i, 16],
      [/семнадцат/i, 17],
      [/восемнадцат/i, 18],
      [/девятнадцат/i, 19],
      [/двадцат/i, 20],
      [/двадцать\s+перв/i, 21],
      [/двадцать\s+втор/i, 22],
      [/двадцать\s+трет/i, 23],
      [/двадцать\s+четверт/i, 24],
      [/двадцать\s+пят/i, 25],
      [/двадцать\s+шест/i, 26],
      [/двадцать\s+седьм/i, 27],
      [/двадцать\s+восьм/i, 28],
      [/двадцать\s+девят/i, 29],
      [/тридцат/i, 30],
      [/тридцать\s+перв/i, 31],
    ];

    // Only consider ordinals if the phrase looks like a date request.
    if (/(?:^|\s)на\s+/.test(t)) {
      for (const [re, d] of ord) {
        if (re.test(t)) {
          day = d;
          break;
        }
      }
    }
  }

  if (!day) return null;

  // Month inference if user mentioned a month.
  for (const [re, m] of months) {
    if (re.test(t)) {
      month = m;
      break;
    }
  }

  // Year explicit: "на 8 января 2026"
  const y = t.match(/(?:^|\s)(20\d{2})(?:\s|$)/);
  if (y && y[1]) year = Number(y[1]);

  let finalY = Number.isFinite(year) ? year : nowY;
  let finalM = Number.isFinite(month) ? month : nowM;
  let finalD = day;

  if (!Number.isFinite(year)) {
    if (Number.isFinite(month)) {
      // If month specified but date already passed this year, shift to next year.
      if (finalM < nowM || (finalM === nowM && finalD <= nowD)) finalY = nowY + 1;
    } else {
      // No month specified: choose next occurrence (this month if in future, else next month).
      if (finalD <= nowD) {
        finalM = nowM + 1;
        if (finalM > 12) {
          finalM = 1;
          finalY = nowY + 1;
        }
      }
    }
  }

  // Validate day for month
  const maxDay = new Date(Date.UTC(finalY, finalM, 0)).getUTCDate();
  if (!Number.isFinite(maxDay) || finalD > maxDay) return null;

  return `${finalY}-${pad2(finalM)}-${pad2(finalD)}`;
}

function inferSocialWeekRangeFromText({ userText, tz }) {
  const t = String(userText || '').trim().toLowerCase();
  if (!t) return null;

  // Phrases: "на этой неделе", "до конца недели", "в течение этой недели"
  const isThisWeek =
    /(на\s+эт(ой|у)\s+недел(е|ю))/i.test(t) ||
    /(на\s+текущ(ей|ую)\s+недел(е|ю))/i.test(t) ||
    /(до\s+конца\s+недел)/i.test(t) ||
    /(в\s+течени(е|и)\s+эт(ой|у)\s+недел)/i.test(t) ||
    /(this\s+week)/i.test(t);
  if (!isThisWeek) return null;

  const today = yyyyMmDdInTz({ tz });
  const m = String(today).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0..6, Sun..Sat
  // We consider week starting Monday; dateBefore is next Monday (exclusive).
  let daysToNextMonday = (8 - weekday) % 7;
  if (daysToNextMonday === 0) daysToNextMonday = 7;
  const dateBefore = addDaysToYyyyMmDd(today, daysToNextMonday);
  return { dateOnOrAfter: today, dateBefore };
}

function inferTasksWeekRangeFromText({ userText, tz }) {
  const t = String(userText || '').trim().toLowerCase();
  if (!t) return null;

  const isThisWeek =
    /(на\s+эт(ой|у)\s+недел(е|ю))/i.test(t) ||
    /(на\s+текущ(ей|ую)\s+недел(е|ю))/i.test(t) ||
    /(до\s+конца\s+недел)/i.test(t) ||
    /(в\s+течени(е|и)\s+эт(ой|у)\s+недел)/i.test(t) ||
    /(this\s+week)/i.test(t);

  const isNextWeek =
    /(на\s+следующ(ей|ую)\s+недел(е|ю))/i.test(t) ||
    /(следующ(ая|ую|ей)\s+недел(я|е|ю))/i.test(t) ||
    /(next\s+week)/i.test(t);

  if (!isThisWeek && !isNextWeek) return null;

  const today = yyyyMmDdInTz({ tz });
  const m = String(today).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0..6, Sun..Sat

  // Week starts Monday; compute next Monday (exclusive end for "this week").
  let daysToNextMonday = (8 - weekday) % 7;
  if (daysToNextMonday === 0) daysToNextMonday = 7;
  const nextMonday = addDaysToYyyyMmDd(today, daysToNextMonday);
  if (!nextMonday) return null;

  if (isNextWeek) {
    const mondayAfterNext = addDaysToYyyyMmDd(nextMonday, 7);
    return { kind: 'next_week', dateOnOrAfter: nextMonday, dateBefore: mondayAfterNext };
  }

  return { kind: 'this_week', dateOnOrAfter: today, dateBefore: nextMonday };
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

  // prefix tokens: help when the user says extra words that Notion title does not contain
  const tokens = base.split(' ').map((x) => x.trim()).filter(Boolean);
  if (tokens.length >= 2) {
    push(tokens[0]);
    push(tokens.slice(0, 2).join(' '));
  }
  // latin-only tokens (common for mixed RU/EN voice: "Automatic 4 единицы" -> "Automatic")
  const latinTokens = tokens.filter((t) => /^[A-Za-z0-9_.:-]+$/.test(t));
  if (latinTokens.length) {
    push(latinTokens.join(' '));
    push(latinTokens[0]);
  }

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

function translitRuToLat(text) {
  const s = String(text || '');
  const map = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };
  let out = '';
  for (const ch of s) {
    const low = ch.toLowerCase();
    const rep = Object.prototype.hasOwnProperty.call(map, low) ? map[low] : ch;
    out += rep;
  }
  return out;
}

function normalizeForFuzzy(text) {
  // Normalize into a simple latin-ish key:
  // - lowercase
  // - strip punctuation
  // - collapse spaces
  // - keep letters+digits only
  const s = String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const latinized = translitRuToLat(s);
  return latinized.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function levenshteinDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s) return t.length;
  if (!t) return s.length;
  const m = s.length;
  const n = t.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function similarityRatio(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const maxLen = Math.max(s.length, t.length);
  if (!maxLen) return 1;
  const dist = levenshteinDistance(s, t);
  return 1 - dist / maxLen;
}

function tokenOverlapScore(a, b) {
  const at = String(a || '')
    .split(' ')
    .map((x) => x.trim())
    .filter(Boolean);
  const bt = String(b || '')
    .split(' ')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!at.length || !bt.length) return 0;
  const bset = new Set(bt);
  const hit = at.filter((x) => bset.has(x)).length;
  return hit / Math.max(1, Math.min(at.length, bt.length));
}

function tokenToTokenFuzzyScore(queryNorm, titleNorm) {
  const STOP = new Set([
    // RU translit stopwords
    'edinitsa',
    'edinitsy',
    'edinic',
    'edinicah',
    'edinicami',
    'edinice',
    'edinicu',
    // common filler
    'zadacha',
    'zadachi',
    'task',
    'board',
    'borda',
  ]);
  const qTokens = String(queryNorm || '')
    .split(' ')
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .filter((x) => /[a-z]/i.test(x))
    .filter((x) => !STOP.has(x));
  const tTokens = String(titleNorm || '')
    .split(' ')
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .filter((x) => /[a-z]/i.test(x))
    .filter((x) => !STOP.has(x));
  if (!qTokens.length || !tTokens.length) return 0;

  let sum = 0;
  let max = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const tt of tTokens) {
      let sim = similarityRatio(qt, tt);
      // Special case: voice often glues words together (e.g. "testworktask" instead of "test work task").
      // If the query token is long enough, treat "contains" as a perfect hit for non-stopword title tokens.
      if (qt.length >= 8 && tt.length >= 4 && qt.includes(tt)) sim = 1;
      if (sim > best) best = sim;
      if (best >= 0.92) break;
    }
    if (best > max) max = best;
    sum += best;
  }
  const avg = sum / qTokens.length;
  // Combine avg + max to prefer at least one strong token hit (RU->EN, voice artifacts).
  return avg * 0.55 + max * 0.45;
}

function scoreTaskTitleMatch({ query, title }) {
  const q = normalizeForFuzzy(query);
  const t = normalizeForFuzzy(title);
  if (!q || !t) return 0;
  const overlap = tokenOverlapScore(q, t);
  const tokenFuzzy = tokenToTokenFuzzyScore(q, t);
  // Prefer token fuzzy. Whole-string similarity is noisy for mismatched long phrases (digits/time),
  // so keep it out of the main score.
  return tokenFuzzy * 0.9 + overlap * 0.1;
}

function buildMultiQueryCandidates(queryText) {
  const raw = String(queryText || '').trim();
  if (!raw) return [];
  const base = raw.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  // We only split by "и" when we have strong signals that the user listed multiple items.
  // This avoids breaking phrases like "найди и удали ..." into garbage queue items.
  const hasListSeparators = /[,;]/.test(base) || /:\s+/.test(base) || /(\s+потом\s+|\s+затем\s+|\s+then\s+)/i.test(base);
  const splitRe = hasListSeparators
    ? /(?:,|;|:\s+|\s+then\s+|\s+потом\s+|\s+затем\s+|\s+и\s+)/i
    : /(?:,|;|:\s+|\s+then\s+|\s+потом\s+|\s+затем\s+)/i;

  // Split on commas and common joiners. Keep it simple and safe.
  const parts = base
    .split(splitRe)
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[-–:]+/, '').trim())
    .filter(Boolean);

  // Remove leading boilerplate fragments from voice/text.
  const cleaned = [];
  const isGarbage = (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return true;
    if (s.length < 4) return true;
    if (/^(привет|приветик|hi|hello|hey)\b/i.test(s)) return true;
    if (/^(найди|поиск|search|find)\b/i.test(s)) return true;
    if (/^(удали(ть)?|удалить|убери(ть)?|убрать|delete|remove)\b/i.test(s)) return true;
    if (/^(задача|задачи|task|tasks)\b/i.test(s)) return true;
    return false;
  };

  for (const p of parts) {
    const v = p
      .replace(
        /^(привет|приветик|hi|hello|hey)[\p{P}\p{S}\s]*/iu,
        ''
      )
      .replace(
        /^(найди|поиск|search|find)[\p{P}\p{S}\s]*/iu,
        ''
      )
      .replace(
        /^(?:и[\p{P}\p{S}\s]+)?(удали(ть)?|удалить|убери(ть)?|убрать|снеси|delete|remove)[\p{P}\p{S}\s]*/iu,
        ''
      )
      .replace(
        /^(из\s+борды\s+с\s+задачами|с\s+борды\s+с\s+задачами|из\s+борды|с\s+борды|в\s+борде|на\s+борде|в\s+борде\s+с\s+задачами|на\s+борде\s+с\s+задачами)[\p{P}\p{S}\s]*/iu,
        ''
      )
      .replace(/^(задач(у|и)|task|tasks)[\p{P}\p{S}\s]*/iu, '')
      .replace(/^(task\s+был|был)[\p{P}\p{S}\s]*/iu, '')
      .replace(/^потом[\p{P}\p{S}\s]*/iu, '')
      .replace(/^затем[\p{P}\p{S}\s]*/iu, '')
      .replace(/^[-–:]+/g, '')
      .trim();
    if (!v) continue;
    if (isGarbage(v)) continue;
    // Trim trailing punctuation/quotes from voice artifacts
    const vv = v.replace(/[.,"'«»]+$/g, '').trim();
    if (!vv) continue;
    if (isGarbage(vv)) continue;
    if (!cleaned.includes(vv)) cleaned.push(vv);
  }
  return cleaned.slice(0, 10);
}

function inferRequestedTaskActionFromText(userText) {
  const t = String(userText || '').toLowerCase();
  // Be strict: only infer action when user clearly asks to delete/remove.
  // "delete" => move_to_deprecated (soft delete)
  if (/(удали(ть)?|удалить|убери(ть)?|убрать|снеси|удал(и|й)\s+задач|delete)/.test(t)) return 'move_to_deprecated';
  // "done" signals
  if (/(сдела(й|и)\s+выполненн|отмет(ь|и)\s+как\s+выполненн|mark\s+done|done)/.test(t)) return 'mark_done';
  return null;
}

async function findTasksFuzzyEnhanced({ notionRepo, queryText, limit }) {
  // 1) Notion title contains (fast, server-side)
  const baseTries = buildQueryVariants(queryText);
  const tries = [];
  for (const q of baseTries) {
    if (q && !tries.includes(q)) tries.push(q);
    const tr = translitRuToLat(q);
    if (tr && tr !== q && !tries.includes(tr)) tries.push(tr);
  }

  const seen = new Set();
  let best = [];
  let bestQuery = tries[0] || queryText;

  for (const q of tries.slice(0, 8)) {
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
    if (best.length >= 2) break;
  }

  if (best.length) return { tasks: best, usedQueryText: bestQuery, source: 'notion' };

  // 2) Fallback: fetch last N tasks and do local fuzzy match.
  // Notion DB query supports max 100 per request. We intentionally keep it lightweight.
  let recent = [];
  try {
    recent = await notionRepo.listTasks({ limit: 100 });
  } catch {
    recent = [];
  }

  const scored = [];
  for (const t of recent || []) {
    if (!t?.id) continue;
    if (Array.isArray(t.tags) && t.tags.includes('Deprecated')) continue;
    const score = scoreTaskTitleMatch({ query: queryText, title: t.title || '' });
    scored.push({ score, task: t });
  }
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0]?.score || 0;
  // If even the best match is too weak, do not suggest anything.
  if (topScore < 0.22) return { tasks: [], usedQueryText: String(queryText || '').trim(), source: 'local' };

  const lim = Math.min(Math.max(1, Number(limit) || 20), 20);
  const threshold = Math.max(0.28, topScore - 0.12);
  const picked = scored.filter((x) => x.score >= threshold).slice(0, lim).map((x) => x.task);
  return { tasks: picked, usedQueryText: String(queryText || '').trim(), source: 'local' };
}

function inferIndexFromText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;

  // Digits: "1", "№2", "номер 3", "id 4" (we keep it simple).
  const m = t.match(/(?:^|[^\d])(?:№\s*)?(\d{1,2})(?:[^\d]|$)/);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 20) return n;
  }

  // RU ordinals
  if (/(перв)/.test(t)) return 1;
  if (/(втор)/.test(t)) return 2;
  if (/(трет)/.test(t)) return 3;
  if (/(четверт)/.test(t)) return 4;
  if (/(пят)/.test(t)) return 5;
  if (/(шест)/.test(t)) return 6;
  if (/(седьм)/.test(t)) return 7;
  if (/(восьм)/.test(t)) return 8;
  if (/(девят)/.test(t)) return 9;
  if (/(десят)/.test(t)) return 10;

  return null;
}

async function findListFuzzyEnhanced({ listFn, queryText, limit }) {
  const baseTries = buildQueryVariants(queryText);
  const tries = [];
  for (const q of baseTries) {
    if (q && !tries.includes(q)) tries.push(q);
    const tr = translitRuToLat(q);
    if (tr && tr !== q && !tries.includes(tr)) tries.push(tr);
  }

  const seen = new Set();
  let best = [];
  let bestQuery = tries[0] || queryText;

  for (const q of tries.slice(0, 8)) {
    const res = await listFn({ queryText: q, limit });
    const uniq = [];
    for (const it of res || []) {
      if (!it?.id) continue;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      uniq.push(it);
    }
    if (uniq.length > best.length) {
      best = uniq;
      bestQuery = q;
    }
    if (best.length >= 2) break;
  }

  if (best.length) return { items: best, usedQueryText: bestQuery, source: 'notion' };

  // Fallback: list last N items and do local fuzzy match.
  let recent = [];
  try {
    recent = await listFn({ limit: 100 });
  } catch {
    recent = [];
  }

  const scored = [];
  for (const it of recent || []) {
    if (!it?.id) continue;
    const title = String(it.title || '').trim();
    if (!title) continue;
    const score = scoreTaskTitleMatch({ query: queryText, title });
    scored.push({ score, item: it });
  }
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0]?.score || 0;
  if (topScore < 0.22) return { items: [], usedQueryText: String(queryText || '').trim(), source: 'local' };

  const lim = Math.min(Math.max(1, Number(limit) || 20), 20);
  const threshold = Math.max(0.28, topScore - 0.12);
  const picked = scored.filter((x) => x.score >= threshold).slice(0, lim).map((x) => x.item);
  return { items: picked, usedQueryText: String(queryText || '').trim(), source: 'local' };
}

async function findIdeasFuzzyEnhanced({ ideasRepo, queryText, limit }) {
  return await findListFuzzyEnhanced({
    listFn: ({ queryText: q, limit: lim }) => ideasRepo.listIdeas({ queryText: q || null, limit: lim ?? 20 }),
    queryText,
    limit,
  });
}

async function findSocialPostsFuzzyEnhanced({ socialRepo, queryText, limit }) {
  return await findListFuzzyEnhanced({
    listFn: ({ queryText: q, limit: lim }) => socialRepo.listPosts({ queryText: q || null, limit: lim ?? 20 }),
    queryText,
    limit,
  });
}

async function findJournalEntriesFuzzyEnhanced({ journalRepo, queryText, limit }) {
  return await findListFuzzyEnhanced({
    listFn: ({ queryText: q, limit: lim }) => journalRepo.listEntries({ queryText: q || null, limit: lim ?? 20 }),
    queryText,
    limit,
  });
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

function buildPickTaskKeyboard({ items }) {
  const rows = [];
  for (const it of items.slice(0, 10)) {
    rows.push([{ text: `${it.index}. ${truncate(it.title, 24)}`, callback_data: `pick:${it.index}`.slice(0, 64) }]);
  }
  rows.push([{ text: 'Отмена', callback_data: 'pick:cancel' }]);
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
  instagram: 'insta',
  insta: 'insta',
  инстаграм: 'insta',
  инстаграме: 'insta',
  инстаграма: 'insta',
  инстаграму: 'insta',
  инстаграмом: 'insta',
  инстаграмм: 'insta',
  инста: 'insta',
  инсте: 'insta',
  инсту: 'insta',
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

function formatTaskCreateSummary({ created, board = 'main' }) {
  const lines = [`Готово. Создал задачу: ${created.title}`];
  lines.push(`База: Tasks (${board})`);

  const tags = normalizeTagsForDisplay(created.tags || []);
  if (tags.length) {
    const tagDisplay = tags.join(', ');
    lines.push(`Категория: ${tagDisplay}`);
  } else {
    lines.push('Категория: не указана');
  }

  if (created.dueDate) {
    lines.push(`Срок: ${created.dueDate}`);
  }
  if (created.priority) {
    lines.push(`Приоритет: ${created.priority}`);
  }
  if (created.status) {
    lines.push(`Статус: ${created.status}`);
  }
  if (created.url) {
    lines.push(`Ссылка: ${created.url}`);
  }

  return lines.join('\n');
}

function formatIdeaCreateSummary({ created }) {
  const lines = [`Готово. Добавил идею: ${created.title}`];
  lines.push('База: Ideas');

  const categories = Array.isArray(created.categories) ? created.categories.filter(Boolean) : [];
  if (categories.length) {
    lines.push(`Категория: ${categories.join(', ')}`);
  } else {
    lines.push('Категория: не указана');
  }

  const tags = Array.isArray(created.tags) ? created.tags.filter(Boolean) : [];
  if (tags.length) {
    lines.push(`Теги: ${tags.join(', ')}`);
  }
  if (created.area) {
    lines.push(`Area: ${created.area}`);
  }
  if (created.project) {
    lines.push(`Project: ${created.project}`);
  }
  if (created.status) {
    lines.push(`Статус: ${created.status}`);
  }
  if (created.priority) {
    lines.push(`Приоритет: ${created.priority}`);
  }
  if (created.url) {
    lines.push(`Ссылка: ${created.url}`);
  }

  return lines.join('\n');
}

function formatSocialPostCreateSummary({ created }) {
  const lines = [`Готово. Добавил пост: ${created.title}`];
  lines.push('База: Social');

  const platforms = Array.isArray(created.platform) ? created.platform.filter(Boolean) : created.platform ? [created.platform] : [];
  if (platforms.length) {
    lines.push(`Платформа: ${platforms.join(', ')}`);
  } else {
    lines.push('Платформа: не указана');
  }

  if (created.status) {
    lines.push(`Статус: ${created.status}`);
  }
  if (created.postDate) {
    lines.push(`Дата поста: ${created.postDate}`);
  }
  const contentTypes = Array.isArray(created.contentType) ? created.contentType.filter(Boolean) : created.contentType ? [created.contentType] : [];
  if (contentTypes.length) {
    lines.push(`Тип: ${contentTypes.join(', ')}`);
  }
  if (created.postUrl) {
    lines.push(`Post URL: ${created.postUrl}`);
  }
  if (created.url) {
    lines.push(`Ссылка: ${created.url}`);
  }

  return lines.join('\n');
}

function formatJournalEntryCreateSummary({ created }) {
  const lines = [`Готово. Добавил запись в дневник: ${created.title}`];
  lines.push('База: Journal');

  if (created.date) {
    lines.push(`Дата: ${created.date}`);
  } else {
    lines.push('Дата: не указана');
  }

  if (created.type) {
    lines.push(`Тип: ${created.type}`);
  }
  const topics = Array.isArray(created.topics) ? created.topics.filter(Boolean) : [];
  if (topics.length) {
    lines.push(`Topics: ${topics.join(', ')}`);
  }
  const context = Array.isArray(created.context) ? created.context.filter(Boolean) : [];
  if (context.length) {
    lines.push(`Context: ${context.join(', ')}`);
  }
  if (created.mood !== null && created.mood !== undefined) {
    lines.push(`Mood: ${created.mood}`);
  }
  if (created.energy !== null && created.energy !== undefined) {
    lines.push(`Energy: ${created.energy}`);
  }
  if (created.url) {
    lines.push(`Ссылка: ${created.url}`);
  }

  return lines.join('\n');
}

module.exports = {
  isDebugEnabled,
  isAiEnabled,
  debugLog,
  safeEditStatus,
  makeId,
  truncate,
  oneLinePreview,
  yyyyMmDdInTz,
  inferDateFromText,
  normalizeDueDateInput,
  inferDueDateFromUserText,
  addDaysToYyyyMmDd,
  inferListHintsFromText,
  inferListDueDateFromText,
  inferSocialWeekRangeFromText,
  inferTasksWeekRangeFromText,
  buildQueryVariants,
  findTasksFuzzy,
  findTasksFuzzyEnhanced,
  buildMultiQueryCandidates,
  normalizeCategoryInput,
  normalizeTagsForDisplay,
  isAffirmativeText,
  isNegativeText,
  buildCategoryKeyboard,
  buildOptionsKeyboard,
  buildDateKeyboard,
  buildAiConfirmKeyboard,
  buildToolConfirmKeyboard,
  buildPickTaskKeyboard,
  formatAiTaskSummary,
  normalizeTitleKey,
  normalizeOptionKey,
  pickBestOptionMatch,
  normalizeMultiOptionValue,
  clampRating1to5,
  hasNonEmptyOptionInput,
  inferJournalTypeFromText,
  inferJournalTopicsFromText,
  inferJournalContextFromText,
  normalizeTitleKeyLocal,
  looksLikeTaskTagsList,
  inferMoodEnergyFromText,
  isJournalRelatedText,
  isJournalListIntent,
  isJournalArchiveIntent,
  isJournalCreateIntent,
  isJournalUpdateIntent,
  isEmptyPatchObject,
  normalizeSocialPlatform,
  normalizeSocialContentType,
  normalizeSocialStatus,
  extractNotionErrorInfo,
  buildPickPlatformKeyboard,
  inferRequestedTaskActionFromText,
  inferIndexFromText,
  findIdeasFuzzyEnhanced,
  findSocialPostsFuzzyEnhanced,
  findJournalEntriesFuzzyEnhanced,
  formatTaskCreateSummary,
  formatIdeaCreateSummary,
  formatSocialPostCreateSummary,
  formatJournalEntryCreateSummary,
};


