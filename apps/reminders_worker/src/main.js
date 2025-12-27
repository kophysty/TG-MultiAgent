const TelegramBot = require('node-telegram-bot-api');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { createPgPoolFromEnv } = require('../../../core/connectors/postgres/client');
const { RemindersRepo } = require('../../../core/connectors/postgres/reminders_repo');
const { NotionTasksRepo } = require('../../../core/connectors/notion/tasks_repo');

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

async function main() {
  hydrateProcessEnv();

  const tz = process.env.TG_TZ || 'Europe/Moscow';
  const dailyAt = process.env.TG_REMINDERS_DAILY_AT || '11:00';
  const { h: dailyH, min: dailyM } = parseHhMm(dailyAt, 11, 0);
  const dayBeforeAt = process.env.TG_REMINDERS_DAY_BEFORE_AT || '23:00';
  const { h: dayBeforeH, min: dayBeforeM } = parseHhMm(dayBeforeAt, 23, 0);
  const beforeMinutes = Number(process.env.TG_REMINDERS_BEFORE_MINUTES || 60);
  const pollSeconds = Math.max(10, Number(process.env.TG_REMINDERS_POLL_SECONDS || 60));

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
  const notionRepo = new NotionTasksRepo({ notionToken, databaseId });

  const botByMode = new Map();
  if (tokenTests) botByMode.set('tests', new TelegramBot(tokenTests, { polling: false, request: { timeout: 60_000 } }));
  if (tokenProd) botByMode.set('prod', new TelegramBot(tokenProd, { polling: false, request: { timeout: 60_000 } }));

  // eslint-disable-next-line no-console
  console.log(`Reminders worker started. tz=${tz} pollSeconds=${pollSeconds} db=${databaseId} modeDefault=${mode}`);

  async function tick() {
    const now = new Date();
    const today = yyyyMmDdInTz(tz, now);
    const tomorrow = addDaysYyyyMmDd(today, 1);

    // Pull tasks for today/tomorrow and Inbox.
    const [dueToday, dueTomorrow, inbox] = await Promise.all([
      notionRepo.listTasks({ dueDate: today, limit: 100 }),
      notionRepo.listTasks({ dueDate: tomorrow, limit: 100 }),
      notionRepo.listTasks({ tag: 'Inbox', limit: 100 }),
    ]);

    const tasksToday = uniqById([...dueToday, ...inbox]).filter((t) => !isDone(t) && !isDeprecated(t));
    const tasksTomorrowDateOnly = uniqById(dueTomorrow).filter((t) => !isDone(t) && !isDeprecated(t) && isDateOnly(t.dueDate));

    const subs = await repo.listEnabledSubscriptions();
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
          const text = `Напоминание (сегодня):\n\n${formatTasksList(tasksToday)}`;
          try {
            await tg.sendMessage(chatId, text);
          } catch {
            await repo.deleteSentReminder({ chatId, pageId: `digest:${today}`, reminderKind: 'daily_11', remindAt });
          }
        }
      }

      // day before digest for date-only tasks due tomorrow
      if (now >= dayBeforeWindowStart && now < dayBeforeWindowEnd && tasksTomorrowDateOnly.length) {
        const remindAt = dayBeforeAtUtc;
        const inserted = await repo.tryInsertSentReminder({
          chatId,
          pageId: `digest:${tomorrow}`,
          reminderKind: 'day_before_23',
          remindAt,
        });
        if (inserted) {
          const text = `Напоминание (завтра):\n\n${formatTasksList(tasksTomorrowDateOnly)}`;
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

        const text = `Напоминание: через ${beforeMinutes} минут\n\n${t.title}`;
        try {
          await tg.sendMessage(chatId, text);
        } catch {
          await repo.deleteSentReminder({ chatId, pageId: t.id, reminderKind: 'before_60m', remindAt });
        }
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('Reminders worker loop started.');
  // Simple polling loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Reminders worker tick error:', e);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal reminders worker error:', err);
  process.exitCode = 1;
});


