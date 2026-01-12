const TelegramBot = require('node-telegram-bot-api');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { createPgPoolFromEnv } = require('../../../core/connectors/postgres/client');
const { RemindersRepo } = require('../../../core/connectors/postgres/reminders_repo');
const { PreferencesRepo } = require('../../../core/connectors/postgres/preferences_repo');
const { ChatMemoryRepo } = require('../../../core/connectors/postgres/chat_memory_repo');
const { WorkContextRepo } = require('../../../core/connectors/postgres/work_context_repo');
const { NotionTasksRepo } = require('../../../core/connectors/notion/tasks_repo');
const { NotionPreferencesRepo } = require('../../../core/connectors/notion/preferences_repo');
const { NotionIdeasRepo } = require('../../../core/connectors/notion/ideas_repo');
const { NotionSocialRepo } = require('../../../core/connectors/notion/social_repo');
const { EventLogRepo } = require('../../../core/connectors/postgres/event_log_repo');
const { sanitizeErrorForLog, sanitizeForLog } = require('../../../core/runtime/log_sanitize');
const { summarizeChat } = require('../../../core/ai/chat_summarizer');
const { makeTraceId } = require('../../../core/runtime/trace');
const { enterWithTrace, getTraceId } = require('../../../core/runtime/trace_context');
const crypto = require('crypto');

function isDebugEnabled() {
  const v = String(process.env.TG_DEBUG || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function debugLog(event, fields = {}) {
  if (!isDebugEnabled()) return;
  const safeFields = {};
  for (const [k, v] of Object.entries(fields || {})) safeFields[k] = sanitizeForLog(v);
  // eslint-disable-next-line no-console
  console.log(`[tg_debug] worker ${event}`, safeFields);
}

function parseHhMm(text, fallbackH = 11, fallbackM = 0) {
  const t = String(text || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: fallbackH, min: fallbackM };
  const h = Math.min(Math.max(Number(m[1]), 0), 23);
  const min = Math.min(Math.max(Number(m[2]), 0), 59);
  return { h, min };
}

function yyyyMmDdInTz(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDaysYyyyMmDd(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // midday to avoid DST edges
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function zonedWallClockToUtc({ tz, yyyyMmDd, h, min, sec = 0 }) {
  const [y, m, d] = String(yyyyMmDd).split('-').map((x) => Number(x));
  const utcGuess = new Date(Date.UTC(y, m - 1, d, h, min, sec));
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(utcGuess);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const got = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  const want = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  if (got === want) return utcGuess;

  // Compute delta in milliseconds between want and got by interpreting both as UTC.
  const gotUtc = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)));
  const wantUtc = new Date(Date.UTC(y, m - 1, d, h, min, sec));
  const deltaMs = wantUtc.getTime() - gotUtc.getTime();
  return new Date(utcGuess.getTime() + deltaMs);
}

function isDateOnly(due) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(due || '').trim());
}

function isDone(task) {
  return String(task?.status || '').trim().toLowerCase() === 'done';
}

function isDeprecated(task) {
  return Array.isArray(task?.tags) && task.tags.some((t) => String(t).trim().toLowerCase() === 'deprecated');
}

function isSocialExcluded(post) {
  const s = String(post?.status || '').trim().toLowerCase();
  if (!s) return false;
  // Keep consistent with todo bot list defaults: exclude published/cancelled from reminders.
  return s === 'published' || s === 'cancelled' || s === 'canceled';
}

function uniqById(tasks) {
  const out = [];
  const seen = new Set();
  for (const t of tasks || []) {
    if (!t?.id) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function formatTasksList(tasks) {
  const items = (tasks || []).slice(0, 30);
  if (!items.length) return '(пусто)';
  return items.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
}

function formatTimeInTz(isoOrDate, tz) {
  const d = new Date(String(isoOrDate));
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function formatSocialPostsForDigest({ posts, tz }) {
  const items = (posts || []).slice(0, 30);
  if (!items.length) return '(пусто)';
  const lines = [];
  for (const p of items) {
    const hhmm = p.postDate && !isDateOnly(p.postDate) ? formatTimeInTz(p.postDate, tz) : null;
    const plats = Array.isArray(p.platform) && p.platform.length ? ` [${p.platform.join(', ')}]` : '';
    const timePart = hhmm ? `${hhmm} - ` : '';
    lines.push(`- ${timePart}${p.title}${plats}`);
  }
  return lines.join('\n');
}

function buildDailySummaryText({ tz, today, dueTasks, inboxTasks, socialPostsToday = [] }) {
  const due = (dueTasks || []).filter((t) => !isDone(t) && !isDeprecated(t));
  // Align with /today semantics: include Inbox only if it has no due date or is due today or earlier (overdue).
  const inbox = (inboxTasks || []).filter(
    (t) =>
      !isDone(t) &&
      !isDeprecated(t) &&
      (!t?.dueDate || String(t.dueDate).slice(0, 10) <= String(today || '').slice(0, 10))
  );

  const timed = [];
  const dateOnly = [];
  for (const t of due) {
    if (isDateOnly(t.dueDate)) dateOnly.push(t);
    else timed.push(t);
  }

  // Sort timed by time in tz (best-effort)
  timed.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  const lines = [`Напоминание (сегодня, ${today}):`, ''];

  lines.push('С дедлайном сегодня:');
  if (!timed.length && !dateOnly.length) {
    lines.push('(пусто)');
  } else {
    for (const t of timed) {
      const hhmm = formatTimeInTz(t.dueDate, tz);
      lines.push(`- ${hhmm || '??:??'} - ${t.title}`);
    }
    for (const t of dateOnly) {
      lines.push(`- ${t.title}`);
    }
  }

  lines.push('');
  lines.push('Inbox:');
  if (!inbox.length) {
    lines.push('(пусто)');
  } else {
    for (const t of inbox.slice(0, 30)) {
      lines.push(`- ${t.title}`);
    }
  }

  lines.push('');
  lines.push('Посты сегодня:');
  lines.push(formatSocialPostsForDigest({ posts: socialPostsToday, tz }));

  return lines.join('\n');
}

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex');
}

function computePreferenceHash({ externalId, key, scope, category, active, valueHuman, valueJson }) {
  // Keep stable: do not include timestamps here.
  const payload = {
    externalId: String(externalId || ''),
    key: String(key || ''),
    scope: String(scope || ''),
    category: String(category || ''),
    active: Boolean(active),
    valueHuman: String(valueHuman || ''),
    valueJson: String(valueJson || ''),
  };
  return md5(JSON.stringify(payload));
}

function buildPreferencesSummary(prefs) {
  const items = Array.isArray(prefs) ? prefs : [];
  if (!items.length) return '(пусто)';

  const lines = [];
  for (const p of items.slice(0, 30)) {
    const key = String(p.pref_key || '').trim();
    const val = String(p.value_human || '').trim();
    if (!key) continue;
    if (val) lines.push(`- ${key}: ${val}`);
    else lines.push(`- ${key}`);
  }
  return lines.length ? lines.join('\n') : '(пусто)';
}

async function main() {
  hydrateProcessEnv();

  const tz = process.env.TG_TZ || 'Europe/Moscow';
  const dailyAt = process.env.TG_REMINDERS_DAILY_AT || '11:00';
  const { h: dailyH, min: dailyM } = parseHhMm(dailyAt, 11, 0);
  const dayBeforeAt = process.env.TG_REMINDERS_DAY_BEFORE_AT || '23:00';
  const { h: dayBeforeH, min: dayBeforeM } = parseHhMm(dayBeforeAt, 23, 0);
  const beforeMinutes = Number(process.env.TG_REMINDERS_BEFORE_MINUTES || 60);
  const pollSeconds = Math.max(10, Number(process.env.TG_REMINDERS_POLL_SECONDS || 60));
  const memorySyncSeconds = Math.max(60, Number(process.env.TG_MEMORY_SYNC_SECONDS || 1800));
  const memoryPushBatch = Math.min(50, Math.max(1, Number(process.env.TG_MEMORY_PUSH_BATCH || 20)));

  const mode = (process.env.TG_BOT_MODE || 'tests').toLowerCase(); // tests|prod (default for new subs)
  const tokenTests = process.env.TELEGRAM_BOT_TOKEN_TESTS || process.env.TELEGRAM_BOT_TOKEN;
  const tokenProd = process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN;

  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_TOKEN_LOCAL;
  if (!notionToken) throw new Error('Notion token missing. Set NOTION_TOKEN.');

  const databaseId =
    process.env.NOTION_TASKS_DB_ID ||
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_DATABASE_ID_LOCAL ||
    '2d6535c900f08191a624d325f66dbe7c';

  const pgPool = createPgPoolFromEnv();
  if (!pgPool) throw new Error('POSTGRES_URL missing for reminders worker.');

  const repo = new RemindersRepo({ pool: pgPool });
  const prefsRepo = new PreferencesRepo({ pool: pgPool });
  const chatMemoryRepo = new ChatMemoryRepo({ pool: pgPool });
  const workCtxRepo = new WorkContextRepo({ pool: pgPool });
  let eventLogRepo = null;
  try {
    await pgPool.query('SELECT 1 FROM event_log LIMIT 1');
    eventLogRepo = new EventLogRepo({ pool: pgPool });
  } catch {
    eventLogRepo = null;
  }
  const notionRepo = new NotionTasksRepo({ notionToken, databaseId, eventLogRepo });
  const ideasDbId = process.env.NOTION_IDEAS_DB_ID || null;
  const socialDbId = process.env.NOTION_SOCIAL_DB_ID || null;
  const ideasRepo = ideasDbId ? new NotionIdeasRepo({ notionToken, databaseId: ideasDbId, eventLogRepo }) : null;
  const socialRepo = socialDbId ? new NotionSocialRepo({ notionToken, databaseId: socialDbId, eventLogRepo }) : null;

  const preferencesDbId = process.env.NOTION_PREFERENCES_DB_ID || null;
  const profilesDbId = process.env.NOTION_PREFERENCE_PROFILES_DB_ID || null;
  const notionPrefsRepo = preferencesDbId ? new NotionPreferencesRepo({ notionToken, preferencesDbId, profilesDbId, eventLogRepo }) : null;

  const botByMode = new Map();
  if (tokenTests) botByMode.set('tests', new TelegramBot(tokenTests, { polling: false, request: { timeout: 60_000 } }));
  if (tokenProd) botByMode.set('prod', new TelegramBot(tokenProd, { polling: false, request: { timeout: 60_000 } }));

  if (eventLogRepo) {
    for (const tg of botByMode.values()) {
      const orig = tg.sendMessage.bind(tg);
      tg.sendMessage = async (chatId, text, options) => {
        eventLogRepo
          .appendEvent({
            traceId: getTraceId() || 'no-trace',
            chatId,
            component: 'telegram',
            event: 'tg_send',
            level: 'info',
            payload: { textLen: text ? String(text).length : 0, textPreview: text ? String(text).slice(0, 80) : null },
          })
          .catch(() => {});
        return await orig(chatId, text, options);
      };
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Reminders worker started. tz=${tz} pollSeconds=${pollSeconds} db=${databaseId} modeDefault=${mode} memorySyncSeconds=${memorySyncSeconds}`
  );
  debugLog('config', {
    tz,
    pollSeconds,
    beforeMinutes,
    dailyAt,
    dayBeforeAt,
    memorySyncSeconds,
    memoryPushBatch,
    modeDefault: mode,
    hasNotionPrefsRepo: Boolean(notionPrefsRepo),
    hasProfilesDb: Boolean(profilesDbId),
    hasTokenTests: Boolean(tokenTests),
    hasTokenProd: Boolean(tokenProd),
  });

  function isChatSummaryEnabled() {
    const v = String(process.env.TG_CHAT_SUMMARY_ENABLED || '').trim().toLowerCase();
    if (!v) return true;
    return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
  }

  const chatMemoryEnabledCacheByChatId = new Map(); // chatId -> { enabled, ts }

  async function isChatMemoryEnabledForChat(chatId) {
    const safeChatId = Number(chatId);
    if (!Number.isFinite(safeChatId)) return true;
    const cached = chatMemoryEnabledCacheByChatId.get(safeChatId);
    if (cached && Date.now() - cached.ts < 5 * 60_000) return Boolean(cached.enabled);
    try {
      const row = await prefsRepo.getPreference({ chatId: safeChatId, scope: 'global', key: 'chat_memory_enabled', activeOnly: false });
      if (!row) {
        chatMemoryEnabledCacheByChatId.set(safeChatId, { enabled: true, ts: Date.now() });
        return true;
      }
      if (row.active === false) {
        chatMemoryEnabledCacheByChatId.set(safeChatId, { enabled: false, ts: Date.now() });
        return false;
      }
      const vHuman = String(row.value_human || '').trim().toLowerCase();
      const vJson = row.value_json || {};
      const v = vJson?.enabled;
      const enabled =
        v === false
          ? false
          : v === true
            ? true
            : vHuman
              ? !(vHuman === '0' || vHuman === 'false' || vHuman === 'off' || vHuman === 'no' || vHuman === 'нет')
              : true;
      chatMemoryEnabledCacheByChatId.set(safeChatId, { enabled, ts: Date.now() });
      return enabled;
    } catch {
      return true;
    }
  }

  async function chatSummaryTick() {
    if (!isChatSummaryEnabled()) return;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    // If tables are missing, disable silently.
    try {
      await pgPool.query('SELECT 1 FROM chat_messages LIMIT 1');
    } catch {
      return;
    }

    const model = process.env.TG_CHAT_SUMMARY_MODEL || process.env.TG_AI_MODEL || 'gpt-4.1-mini';
    const batch = Math.min(10, Math.max(1, Number(process.env.TG_CHAT_SUMMARY_BATCH || 3)));
    const lastN = Math.min(200, Math.max(10, Number(process.env.TG_CHAT_MEMORY_LAST_N || 50)));

    const candidates = await chatMemoryRepo.listChatsNeedingSummary({ limit: batch });
    if (!candidates.length) return;

    for (const c of candidates) {
      const chatId = Number(c.chat_id);
      const lastMessageId = Number(c.last_message_id);
      if (!Number.isFinite(chatId) || !Number.isFinite(lastMessageId)) continue;
      if (!(await isChatMemoryEnabledForChat(chatId))) continue;

      try {
        const [sumRow, rows] = await Promise.all([
          chatMemoryRepo.getSummary({ chatId }),
          chatMemoryRepo.listLastN({ chatId, limit: lastN }),
        ]);
        const priorSummary = sumRow?.summary ? String(sumRow.summary) : '';
        const messages = (rows || []).map((r) => ({ role: r.role, text: r.text }));
        const res = await summarizeChat({ apiKey, model, priorSummary, messages });
        await chatMemoryRepo.upsertSummary({ chatId, summary: res.summary, lastMessageId });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('chatSummaryTick error:', sanitizeErrorForLog(e), { chatId: sanitizeForLog(chatId) });
      }
    }

    const ttlDays = Math.min(3650, Math.max(1, Number(process.env.TG_CHAT_MEMORY_TTL_DAYS || 30)));
    try {
      await chatMemoryRepo.purgeOldMessages({ ttlDays });
    } catch {
      // ignore
    }
  }

  function isWorkContextEnabled() {
    const v = String(process.env.TG_WORK_CONTEXT_ENABLED || '').trim().toLowerCase();
    if (!v) return true;
    return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
  }

  async function listWorkContextChatIds() {
    // Prefer enabled subscriptions. If none exist, fall back to chats seen in chat memory (if enabled).
    const subs = await repo.listEnabledSubscriptions();
    const ids = new Set((subs || []).map((s) => Number(s.chatId)).filter((x) => Number.isFinite(x)));
    if (ids.size) return Array.from(ids);

    try {
      const res = await pgPool.query(
        `
        SELECT DISTINCT chat_id
        FROM chat_messages
        WHERE created_at >= NOW() - interval '30 days'
        ORDER BY chat_id ASC
        LIMIT 200
        `
      );
      for (const r of res.rows || []) {
        const id = Number(r.chat_id);
        if (Number.isFinite(id)) ids.add(id);
      }
    } catch {
      // ignore
    }
    return Array.from(ids);
  }

  function renderTasksCompact({ overdue, upcoming, inbox }) {
    const lines = [];
    lines.push('Tasks (контекст):');
    if (overdue?.length) {
      lines.push('Overdue:');
      for (const t of overdue.slice(0, 7)) lines.push(`- ${t.title}`);
    }
    if (upcoming?.length) {
      lines.push('Next 15d:');
      for (const t of upcoming.slice(0, 10)) {
        const due = t.dueDate ? ` (${String(t.dueDate).slice(0, 10)})` : '';
        lines.push(`- ${t.title}${due}`);
      }
    }
    if (inbox?.length) {
      lines.push('Inbox:');
      for (const t of inbox.slice(0, 7)) lines.push(`- ${t.title}`);
    }
    return lines.join('\n');
  }

  function renderIdeasCompact(ideas) {
    const lines = ['Ideas (recent):'];
    const items = Array.isArray(ideas) ? ideas : [];
    if (!items.length) {
      lines.push('(пусто)');
      return lines.join('\n');
    }
    for (const it of items.slice(0, 10)) lines.push(`- ${it.title}`);
    return lines.join('\n');
  }

  function renderSocialCompact(posts) {
    const lines = ['Social (window -10..+10d):'];
    const items = Array.isArray(posts) ? posts : [];
    if (!items.length) {
      lines.push('(пусто)');
      return lines.join('\n');
    }
    for (const it of items.slice(0, 10)) {
      const d = it.postDate ? ` (${String(it.postDate).slice(0, 10)})` : '';
      const plats = Array.isArray(it.platform) && it.platform.length ? ` [${it.platform.join(', ')}]` : '';
      lines.push(`- ${it.title}${plats}${d}`);
    }
    return lines.join('\n');
  }

  async function workContextTick() {
    if (!isWorkContextEnabled()) return;
    if (!ideasRepo || !socialRepo) return;

    // Ensure table exists.
    try {
      await pgPool.query('SELECT 1 FROM work_context_cache LIMIT 1');
    } catch {
      return;
    }

    const chatIds = await listWorkContextChatIds();
    if (!chatIds.length) return;

    const tzName = tz || 'Europe/Moscow';
    const today = yyyyMmDdInTz(tzName, new Date());
    const todayStartUtc = zonedWallClockToUtc({ tz: tzName, yyyyMmDd: today, h: 0, min: 0 });
    const windowEndUtc = zonedWallClockToUtc({ tz: tzName, yyyyMmDd: addDaysYyyyMmDd(today, 16), h: 0, min: 0 });
    const socialStart = addDaysYyyyMmDd(today, -10);
    const socialEnd = addDaysYyyyMmDd(today, 11);

    const [overdueRaw, upcomingRaw, inboxRaw, ideasRaw, socialRaw] = await Promise.all([
      notionRepo.listTasks({ dueDateBefore: todayStartUtc.toISOString(), limit: 50 }),
      notionRepo.listTasks({ dueDateOnOrAfter: todayStartUtc.toISOString(), dueDateBefore: windowEndUtc.toISOString(), limit: 100 }),
      notionRepo.listTasks({ tag: 'Inbox', limit: 50 }),
      ideasRepo.listIdeas({ limit: 10 }),
      socialRepo.listPosts({ dateOnOrAfter: socialStart, dateBefore: socialEnd, limit: 30 }),
    ]);

    const overdue = uniqById(overdueRaw).filter((t) => !isDone(t) && !isDeprecated(t));
    const upcoming = uniqById(upcomingRaw).filter((t) => !isDone(t) && !isDeprecated(t));
    const inbox = uniqById(inboxRaw).filter((t) => !isDone(t) && !isDeprecated(t));

    const payload = {
      tz: tzName,
      today,
      tasks: { overdue: overdue.slice(0, 12), upcoming: upcoming.slice(0, 15), inbox: inbox.slice(0, 12) },
      ideas: (ideasRaw || []).slice(0, 12),
      social: (socialRaw || []).slice(0, 12),
      text: [renderTasksCompact({ overdue, upcoming, inbox }), '', renderIdeasCompact(ideasRaw), '', renderSocialCompact(socialRaw)]
        .join('\n')
        .trim(),
      updatedAt: new Date().toISOString(),
    };

    const payloadHash = md5(JSON.stringify({ tz: payload.tz, today: payload.today, tasks: payload.tasks, ideas: payload.ideas, social: payload.social }));

    // Write the same payload per chat_id (isolation by key). This avoids cross-chat leakage if we later add per-chat fields.
    for (const chatId of chatIds) {
      try {
        await workCtxRepo.upsertCache({ chatId, key: 'work_ctx', payload, payloadHash });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('workContextTick error:', sanitizeErrorForLog(e), { chatId: sanitizeForLog(chatId) });
      }
    }
  }

  async function tick() {
    const now = new Date();
    const today = yyyyMmDdInTz(tz, now);
    const tomorrow = addDaysYyyyMmDd(today, 1);
    const dayAfterTomorrow = addDaysYyyyMmDd(today, 2);

    // Pull tasks for today/tomorrow and Inbox.
    // Use a day-range query for "today" to include both date-only and datetime tasks in the local timezone.
    const dayStartUtc = zonedWallClockToUtc({ tz, yyyyMmDd: today, h: 0, min: 0 });
    const nextDayStartUtc = zonedWallClockToUtc({ tz, yyyyMmDd: tomorrow, h: 0, min: 0 });

    const [dueToday, dueTomorrow, inbox, socialRange] = await Promise.all([
      notionRepo.listTasks({ dueDateOnOrAfter: dayStartUtc.toISOString(), dueDateBefore: nextDayStartUtc.toISOString(), limit: 100 }),
      notionRepo.listTasks({ dueDate: tomorrow, limit: 100 }),
      notionRepo.listTasks({ tag: 'Inbox', limit: 100 }),
      socialRepo
        ? socialRepo.listPosts({
            requireDate: true,
            excludeStatuses: ['Published', 'Cancelled', 'Canceled'],
            dateOnOrAfter: today,
            dateBefore: dayAfterTomorrow,
            limit: 100,
          })
        : Promise.resolve([]),
    ]);

    const tasksToday = uniqById([...dueToday, ...inbox]).filter((t) => !isDone(t) && !isDeprecated(t));
    const tasksTomorrowDateOnly = uniqById(dueTomorrow).filter((t) => !isDone(t) && !isDeprecated(t) && isDateOnly(t.dueDate));

    const socialActive = uniqById(socialRange).filter((p) => p?.postDate && !isSocialExcluded(p));
    const socialToday = socialActive.filter((p) => String(p.postDate).slice(0, 10) === today);
    const socialTomorrow = socialActive.filter((p) => String(p.postDate).slice(0, 10) === tomorrow);
    const socialTomorrowDateOnly = socialTomorrow.filter((p) => isDateOnly(p.postDate));

    const subs = await repo.listEnabledSubscriptions();
    debugLog('tick_snapshot', {
      now: now.toISOString(),
      today,
      subs: subs.length,
      dueToday: dueToday.length,
      inbox: inbox.length,
      tasksToday: tasksToday.length,
      tasksTomorrowDateOnly: tasksTomorrowDateOnly.length,
      socialToday: socialToday.length,
      socialTomorrow: socialTomorrow.length,
    });
    if (!subs.length) return;

    // Daily at HH:MM (send one digest per chat).
    const dailyAtUtc = zonedWallClockToUtc({ tz, yyyyMmDd: today, h: dailyH, min: dailyM });
    const dailyWindowStart = new Date(dailyAtUtc.getTime());
    const dailyWindowEnd = new Date(dailyAtUtc.getTime() + pollSeconds * 1000);

    // Day before at 23:00 for date-only tasks (based on tasks due tomorrow).
    const dayBeforeAtUtc = zonedWallClockToUtc({ tz, yyyyMmDd: today, h: dayBeforeH, min: dayBeforeM });
    const dayBeforeWindowStart = new Date(dayBeforeAtUtc.getTime());
    const dayBeforeWindowEnd = new Date(dayBeforeAtUtc.getTime() + pollSeconds * 1000);

    for (const sub of subs) {
      const chatId = sub.chatId;
      const botMode = sub.botMode || mode;
      const tg = botByMode.get(botMode) || botByMode.get(mode);
      if (!tg) continue;
      const sentStats = {
        dailyInserted: 0,
        dayBeforeInserted: 0,
        before60Inserted: 0,
        socialBefore60Inserted: 0,
      };

      // daily digest
      if (now >= dailyWindowStart && now < dailyWindowEnd) {
        const remindAt = dailyAtUtc;
        const inserted = await repo.tryInsertSentReminder({
          chatId,
          pageId: `digest:${today}`,
          reminderKind: 'daily_11',
          remindAt,
        });
        if (inserted) {
          sentStats.dailyInserted += 1;
          const text = buildDailySummaryText({
            tz,
            today,
            dueTasks: dueToday,
            inboxTasks: inbox,
            socialPostsToday: socialToday,
          });
          try {
            // Daily digest should be silent by default (no notification sound).
            await tg.sendMessage(chatId, text, { disable_notification: true });
          } catch {
            await repo.deleteSentReminder({ chatId, pageId: `digest:${today}`, reminderKind: 'daily_11', remindAt });
          }
        }
      }

      // day before digest for date-only tasks due tomorrow
      if (now >= dayBeforeWindowStart && now < dayBeforeWindowEnd && (tasksTomorrowDateOnly.length || socialTomorrowDateOnly.length)) {
        const remindAt = dayBeforeAtUtc;
        const inserted = await repo.tryInsertSentReminder({
          chatId,
          pageId: `digest:${tomorrow}`,
          reminderKind: 'day_before_23',
          remindAt,
        });
        if (inserted) {
          sentStats.dayBeforeInserted += 1;
          const parts = ['Напоминание (завтра):', ''];
          if (tasksTomorrowDateOnly.length) {
            parts.push('Задачи:');
            parts.push(formatTasksList(tasksTomorrowDateOnly));
          }
          if (socialTomorrowDateOnly.length) {
            if (tasksTomorrowDateOnly.length) parts.push('');
            parts.push('Посты:');
            parts.push(formatSocialPostsForDigest({ posts: socialTomorrowDateOnly, tz }));
          }
          const text = parts.join('\n');
          try {
            await tg.sendMessage(chatId, text);
          } catch {
            await repo.deleteSentReminder({ chatId, pageId: `digest:${tomorrow}`, reminderKind: 'day_before_23', remindAt });
          }
        }
      }

      // before due datetime (per task)
      const timedCandidates = uniqById([...dueToday, ...dueTomorrow]).filter((t) => !isDone(t) && !isDeprecated(t) && !isDateOnly(t.dueDate));
      for (const t of timedCandidates) {
        const due = new Date(String(t.dueDate));
        if (!Number.isFinite(due.getTime())) continue;
        const remindAt = new Date(due.getTime() - beforeMinutes * 60_000);
        if (!(now >= remindAt && now < new Date(remindAt.getTime() + pollSeconds * 1000))) continue;

        const inserted = await repo.tryInsertSentReminder({
          chatId,
          pageId: t.id,
          reminderKind: 'before_60m',
          remindAt,
        });
        if (!inserted) continue;
        sentStats.before60Inserted += 1;

        const text = `Напоминание: через ${beforeMinutes} минут\n\n${t.title}`;
        try {
          await tg.sendMessage(chatId, text);
        } catch {
          await repo.deleteSentReminder({ chatId, pageId: t.id, reminderKind: 'before_60m', remindAt });
        }
      }

      // before Post date (per social post)
      const socialTimedCandidates = uniqById([...socialToday, ...socialTomorrow]).filter((p) => p?.postDate && !isDateOnly(p.postDate));
      for (const p of socialTimedCandidates) {
        const due = new Date(String(p.postDate));
        if (!Number.isFinite(due.getTime())) continue;
        const remindAt = new Date(due.getTime() - beforeMinutes * 60_000);
        if (!(now >= remindAt && now < new Date(remindAt.getTime() + pollSeconds * 1000))) continue;

        const inserted = await repo.tryInsertSentReminder({
          chatId,
          pageId: `social:${p.id}`,
          reminderKind: 'social_before_60m',
          remindAt,
        });
        if (!inserted) continue;
        sentStats.socialBefore60Inserted += 1;

        const hhmm = formatTimeInTz(p.postDate, tz);
        const plats = Array.isArray(p.platform) && p.platform.length ? ` [${p.platform.join(', ')}]` : '';
        const text = `Напоминание: пост через ${beforeMinutes} минут\n\n${hhmm ? `${hhmm} - ` : ''}${p.title}${plats}`;
        try {
          await tg.sendMessage(chatId, text);
        } catch {
          await repo.deleteSentReminder({ chatId, pageId: `social:${p.id}`, reminderKind: 'social_before_60m', remindAt });
        }
      }

      if (sentStats.dailyInserted || sentStats.dayBeforeInserted || sentStats.before60Inserted || sentStats.socialBefore60Inserted) {
        debugLog('tick_send', { chatId, botMode, ...sentStats });
      }
    }
  }

  async function memoryTick({ forced = false } = {}) {
    if (!notionPrefsRepo) return;

    const stats = {
      forced: Boolean(forced),
      workerRunRequests: [], // { chatId, send, requestedAt }
      push_claimed: 0,
      push_ok: 0,
      push_rescheduled: 0,
      pull_applied: 0,
      pull_seen: 0,
      profile_enqueued: 0,
      touched_chats: 0,
    };

    if (stats.forced) debugLog('memory_tick_start', { forced: true });

    // 1) Push pending updates to Notion (write-through with retries).
    async function processPushQueue({ drain = false } = {}) {
      let loops = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        loops += 1;
        const leaseSeconds = drain ? 300 : memorySyncSeconds;
        const queueItems = await prefsRepo.claimQueueBatch({ limit: memoryPushBatch, leaseSeconds });
        if (!queueItems.length) break;
        stats.push_claimed += queueItems.length;

        for (const it of queueItems) {
          try {
            const kind = String(it.kind || '').trim();
            const externalId = String(it.external_id || '').trim();
            const payload = it.payload || {};

            if (kind === 'worker_run') {
              const chatId = Number(payload?.chatId);
              stats.workerRunRequests.push({
                chatId: Number.isFinite(chatId) ? chatId : null,
                send: Boolean(payload?.send),
                requestedAt: payload?.requestedAt ? String(payload.requestedAt) : null,
              });
              await prefsRepo.deleteQueueItem({ id: it.id });
              stats.push_ok += 1;
              continue;
            }

            if (kind === 'pref_page_upsert') {
              const safePayload = { ...(payload || {}) };
              // Notion DB Category select may not contain "memory_note". Do not set Category in Notion for notes.
              if (
                safePayload.category === 'memory_note' ||
                safePayload.category === 'settings' ||
                String(safePayload.key || '').startsWith('memory.note.')
              )
                safePayload.category = null;
              const res = await notionPrefsRepo.upsertPreferencePage(safePayload);
              const pushedHash = it.payload_hash ? String(it.payload_hash) : null;
              if (externalId && pushedHash) {
                await prefsRepo.upsertSyncRow({
                  externalId,
                  chatId: safePayload.chatId,
                  scope: safePayload.scope || 'global',
                  key: safePayload.key,
                  notionPageId: res.pageId,
                  lastPushedHash: pushedHash,
                  lastPushedAt: new Date().toISOString(),
                });
              }
            } else if (kind === 'profile_upsert') {
              if (!profilesDbId) {
                // Profiles DB is optional. Drop profile jobs if it is not configured.
                await prefsRepo.deleteQueueItem({ id: it.id });
                stats.push_ok += 1;
                continue;
              }
              await notionPrefsRepo.upsertProfilePage(payload);
            }

            await prefsRepo.deleteQueueItem({ id: it.id });
            stats.push_ok += 1;
          } catch (e) {
            const attempt = Number(it.attempt || 0);
            const delay = Math.min(3600, Math.max(30, 30 * 2 ** Math.min(attempt + 1, 10)));
            await prefsRepo.rescheduleQueueItem({
              id: it.id,
              error: String(e?.message || e),
              delaySeconds: delay,
              incrementAttempt: true,
            });
            stats.push_rescheduled += 1;
          }
        }

        if (!drain) break;
        if (loops >= 10) break;
      }
    }

    await processPushQueue({ drain: stats.forced });
    debugLog('memory_push_done', {
      forced: stats.forced,
      push_claimed: stats.push_claimed,
      push_ok: stats.push_ok,
      push_rescheduled: stats.push_rescheduled,
    });

    // 2) Pull user edits from Notion and apply to Postgres (Notion wins).
    const sinceIso = await prefsRepo.getMaxLastSeenNotionEditedAt({ overlapSeconds: 120 });
    let cursor = null;
    const touchedChats = new Set();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await notionPrefsRepo.listPreferencesEditedSince({
        sinceIso,
        pageSize: 100,
        startCursor: cursor,
      });

      for (const raw of page.results) {
        const parsed = notionPrefsRepo.parsePreferencePage(raw);
        if (!parsed.pageId) continue;
        if (!Number.isFinite(parsed.chatId || NaN)) continue;
        if (!parsed.key) continue;
        stats.pull_seen += 1;

        const scope = parsed.scope || 'global';
        const externalId = parsed.externalId || prefsRepo.makeExternalId({ chatId: parsed.chatId, scope, key: parsed.key });

        const effectiveActive = Boolean(parsed.active) && !parsed.archived;
        const computedHash = parsed.syncHash || computePreferenceHash({ ...parsed, externalId, active: effectiveActive });

        const syncRow = await prefsRepo.getSyncRowByExternalId({ externalId });
        const lastPushedHash = syncRow?.last_pushed_hash || null;

        // If this matches our last pushed hash, treat it as already applied.
        if (computedHash !== lastPushedHash) {
          await prefsRepo.upsertPreference({
            chatId: parsed.chatId,
            scope,
            category: parsed.category,
            key: parsed.key,
            valueJson: parsed.valueJson ? { text: parsed.valueJson } : {},
            valueHuman: parsed.valueHuman || null,
            active: effectiveActive,
            source: 'notion',
          });
          touchedChats.add(Number(parsed.chatId));
          stats.pull_applied += 1;
        }

        await prefsRepo.upsertSyncRow({
          externalId,
          chatId: parsed.chatId,
          scope,
          key: parsed.key,
          notionPageId: parsed.pageId,
          lastSeenNotionEditedAt: parsed.notionEditedAt || new Date().toISOString(),
        });
      }

      if (!page.hasMore) break;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    debugLog('memory_pull_done', { pull_seen: stats.pull_seen, pull_applied: stats.pull_applied, touched: touchedChats.size });

    // 3) Update per-chat profile summary in Notion (write-through queue).
    if (profilesDbId) {
      for (const chatId of touchedChats) {
        const prefs = await prefsRepo.listPreferencesForChat({ chatId, activeOnly: true });
        const summary = buildPreferencesSummary(prefs);
        await prefsRepo.enqueueNotionSync({
          kind: 'profile_upsert',
          externalId: `profile:${chatId}`,
          payload: { chatId, externalId: `profile:${chatId}`, summary, updatedAt: new Date().toISOString() },
          payloadHash: md5(summary),
        });
        stats.profile_enqueued += 1;
      }
    }
    stats.touched_chats = touchedChats.size;

    // If forced by /worker_run, try to drain queue again so profile updates also land in Notion immediately.
    if (stats.forced) {
      await processPushQueue({ drain: true });
      debugLog('memory_tick_forced_done', {
        push_claimed: stats.push_claimed,
        push_ok: stats.push_ok,
        push_rescheduled: stats.push_rescheduled,
        pull_seen: stats.pull_seen,
        pull_applied: stats.pull_applied,
        profile_enqueued: stats.profile_enqueued,
        touched: stats.touched_chats,
      });
    }

    return stats;
  }

  // eslint-disable-next-line no-console
  console.log('Reminders worker loop started.');
  let nextMemoryRunAt = 0;
  let nextChatSummaryRunAt = 0;
  const chatSummarySeconds = Math.max(60, Number(process.env.TG_CHAT_SUMMARY_SECONDS || 900));
  let nextWorkCtxRunAt = 0;
  const workCtxSeconds = Math.max(60, Number(process.env.TG_WORK_CONTEXT_SECONDS || 1800));
  let nextEventLogPurgeRunAt = 0;
  const eventLogPurgeSeconds = Math.max(60, Number(process.env.TG_EVENT_LOG_PURGE_SECONDS || 6 * 3600));

  async function eventLogPurgeTick() {
    if (!eventLogRepo) return;
    const ttlDays = Math.max(1, Number(process.env.TG_EVENT_LOG_TTL_DAYS || 90));
    await eventLogRepo.purgeOld({ ttlDays });
  }
  // Simple polling loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      enterWithTrace(makeTraceId());
      await tick();
      const nowMs = Date.now();
      let forced = false;
      let forcedRequest = null; // { id, payload }
      try {
        const r = await pgPool.query(
          `SELECT id, payload
           FROM notion_sync_queue
           WHERE kind = 'worker_run' AND next_run_at <= NOW()
           ORDER BY next_run_at ASC, id ASC
           LIMIT 1`
        );
        forced = Boolean(r?.rows?.length);
        forcedRequest = forced ? r.rows[0] : null;
      } catch {
        forced = false;
        forcedRequest = null;
      }

      if (forced) {
      const res = await memoryTick({ forced: true });
        nextMemoryRunAt = nowMs + memorySyncSeconds * 1000;

        // Best-effort report to requester (first request only).
        const payload = forcedRequest?.payload && typeof forcedRequest.payload === 'object' ? forcedRequest.payload : {};
        const reportChatId = Number(payload?.chatId);
        const tg = botByMode.get(mode);
        if (tg && Number.isFinite(reportChatId)) {
          const pendingRes = await pgPool
            .query(`SELECT COUNT(*)::int AS cnt FROM notion_sync_queue WHERE kind IN ('pref_page_upsert','profile_upsert')`)
            .catch(() => ({ rows: [{ cnt: null }] }));
          const pending = pendingRes?.rows?.[0]?.cnt;
          const lines = [
            'worker_run: синхронизация memory выполнена.',
            `- push: claimed=${res?.push_claimed || 0}, ok=${res?.push_ok || 0}, rescheduled=${res?.push_rescheduled || 0}`,
            `- pull: seen=${res?.pull_seen || 0}, applied=${res?.pull_applied || 0}`,
            `- profile: enqueued=${res?.profile_enqueued || 0}`,
            `- touchedChats=${res?.touched_chats || 0}`,
            pending === null || pending === undefined ? null : `- queue pending (pref/profile)=${pending}`,
            '',
            'Если в Notion все еще не видно новых preferences, проверь /errors и логи воркера.',
          ].filter(Boolean);
          tg.sendMessage(reportChatId, lines.join('\n')).catch(() => {});
        }

        // Ensure we don't re-run on the same request forever (even if it wasn't claimed by memoryTick for some reason).
        if (forcedRequest?.id) {
          pgPool.query(`DELETE FROM notion_sync_queue WHERE id = $1 AND kind = 'worker_run'`, [Number(forcedRequest.id)]).catch(() => {});
        }
      } else if (nowMs >= nextMemoryRunAt) {
        await memoryTick();
        nextMemoryRunAt = nowMs + memorySyncSeconds * 1000;
      }
      if (nowMs >= nextChatSummaryRunAt) {
        await chatSummaryTick();
        nextChatSummaryRunAt = nowMs + chatSummarySeconds * 1000;
      }
      if (nowMs >= nextWorkCtxRunAt) {
        await workContextTick();
        nextWorkCtxRunAt = nowMs + workCtxSeconds * 1000;
      }
      if (nowMs >= nextEventLogPurgeRunAt) {
        await eventLogPurgeTick();
        nextEventLogPurgeRunAt = nowMs + eventLogPurgeSeconds * 1000;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Reminders worker tick error:', sanitizeErrorForLog(e));
      if (eventLogRepo) {
        const traceId = getTraceId() || makeTraceId();
        eventLogRepo
          .appendEvent({
            traceId,
            component: 'worker',
            event: 'tick_error',
            level: 'error',
            payload: sanitizeErrorForLog(e),
          })
          .catch(() => {});
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal reminders worker error:', sanitizeErrorForLog(err));
  process.exitCode = 1;
});


