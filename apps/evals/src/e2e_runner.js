const fs = require('fs');
const path = require('path');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { planAgentAction } = require('../../../core/ai/agent_planner');

const { NotionTasksRepo } = require('../../../core/connectors/notion/tasks_repo');
const { NotionIdeasRepo } = require('../../../core/connectors/notion/ideas_repo');
const { NotionSocialRepo } = require('../../../core/connectors/notion/social_repo');
const { NotionJournalRepo } = require('../../../core/connectors/notion/journal_repo');
const { createNotionHttpClient } = require('../../../core/connectors/notion/client');

const { createToolExecutor } = require('../../../core/dialogs/todo_bot_executor');
const { createCallbackQueryHandler } = require('../../../core/dialogs/todo_bot_callbacks');

const { createPgPoolFromEnv } = require('../../../core/connectors/postgres/client');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function parseArgs(argv) {
  const out = {
    dataset: null,
    limit: null,
    out: null,
    tz: null,
    nowIso: null,
    prefix: null,
    chatId: 9990001,
    model: null,
    llmSleepMs: 350,
    opSleepMs: 450,
    batchEvery: 25,
    batchSleepMs: 2500,
    cleanup: true,
    mutation: true,
    trashOnly: true, // NEW: use in_trash instead of archived
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset' && argv[i + 1]) out.dataset = String(argv[++i]);
    if (a === '--limit' && argv[i + 1]) out.limit = Number(argv[++i]);
    if (a === '--out' && argv[i + 1]) out.out = String(argv[++i]);
    if (a === '--tz' && argv[i + 1]) out.tz = String(argv[++i]);
    if (a === '--now-iso' && argv[i + 1]) out.nowIso = String(argv[++i]);
    if (a === '--prefix' && argv[i + 1]) out.prefix = String(argv[++i]);
    if (a === '--chat-id' && argv[i + 1]) out.chatId = Number(argv[++i]);
    if (a === '--model' && argv[i + 1]) out.model = String(argv[++i]);
    if (a === '--llm-sleep-ms' && argv[i + 1]) out.llmSleepMs = Number(argv[++i]);
    if (a === '--op-sleep-ms' && argv[i + 1]) out.opSleepMs = Number(argv[++i]);
    if (a === '--batch-every' && argv[i + 1]) out.batchEvery = Number(argv[++i]);
    if (a === '--batch-sleep-ms' && argv[i + 1]) out.batchSleepMs = Number(argv[++i]);
    if (a === '--no-cleanup') out.cleanup = false;
    if (a === '--no-mutation') out.mutation = false;
    if (a === '--archive-cleanup') out.trashOnly = false; // fallback to archived
    if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  return [
    'Usage:',
    '  node apps/evals/src/e2e_runner.js --dataset <path.jsonl> [options]',
    '',
    'Options:',
    '  --dataset <path>         Path to jsonl dataset (required)',
    '  --limit <N>              Run only first N cases',
    '  --out <path>             Write report json to this path (default: data/evals/e2e-report-<ts>.json)',
    '  --model <name>           Override TG_AI_MODEL for planner',
    '  --tz <IANA>              Override timezone per run',
    '  --now-iso <iso>          Override nowIso per run',
    '  --prefix <text>          Prefix to mark all created records',
    '  --chat-id <id>           chatId used for Postgres preferences (default 9990001)',
    '  --llm-sleep-ms <ms>      Sleep after each LLM call (default 350)',
    '  --op-sleep-ms <ms>       Sleep after each tool/confirm operation (default 450)',
    '  --batch-every <N>        Extra sleep after every N operations (default 25)',
    '  --batch-sleep-ms <ms>    Extra sleep duration (default 2500)',
    '  --no-cleanup             Do not trash/archive created records and do not delete test preferences',
    '  --no-mutation            Disable mutation sweep (mode B post-create extra operations)',
    '  --archive-cleanup        Use archived:true instead of in_trash:true for cleanup (fallback)',
  ].join('\n');
}

function safeJsonParse(line, idx) {
  try {
    return JSON.parse(line);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`dataset json parse error at line ${idx}: ${msg}`);
  }
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const out = [];
  let lineNo = 0;
  for (const l of lines) {
    lineNo += 1;
    const s = String(l || '').trim();
    if (!s) continue;
    if (s.startsWith('#')) continue;
    out.push({ lineNo, obj: safeJsonParse(s, lineNo) });
  }
  return out;
}

function isPlainObject(x) {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x));
}

function sanitizePrefixText(x) {
  const s = String(x || '').replace(/\s+/g, ' ').trim();
  return s;
}

function buildRunPrefix({ basePrefix, datasetName }) {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const ds = String(datasetName || '').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40);
  const p = basePrefix ? sanitizePrefixText(basePrefix) : `[E2E ${ts} ${ds}]`;
  return p;
}

function withPrefixedTitle({ prefix, caseId, title }) {
  const t = String(title || '').trim();
  const safePrefix = sanitizePrefixText(prefix);
  const c = String(caseId || '').trim();
  const head = c ? `${safePrefix} [${c}]` : safePrefix;
  if (!t) return `${head}`;
  if (t.startsWith(head)) return t;
  return `${head} ${t}`;
}

function summarizeTextShort(text, maxLen = 60) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 3))}...`;
}

function extractInlineKeyboardCallbackData(opts) {
  const kb = opts && opts.reply_markup && opts.reply_markup.inline_keyboard ? opts.reply_markup.inline_keyboard : null;
  const rows = Array.isArray(kb) ? kb : [];
  const out = [];
  for (const row of rows) {
    const btns = Array.isArray(row) ? row : [];
    for (const b of btns) {
      const data = b && b.callback_data ? String(b.callback_data) : null;
      if (data) out.push(data);
    }
  }
  return out;
}

// Patterns to detect soft errors in agent messages
const SOFT_ERROR_PATTERNS = [
  /не нашел/i,
  /не понял/i,
  /уточни/i,
  /не могу/i,
  /ошибка/i,
  /недоступен/i,
  /не удалось/i,
  /не получилось/i,
  /не существует/i,
  /некорректн/i,
  /невалидн/i,
  /попробуй еще раз/i,
  /попробуй снова/i,
  /что именно/i,
  /какую именно/i,
  /укажи/i,
];

function detectSoftError(text) {
  const t = String(text || '');
  for (const p of SOFT_ERROR_PATTERNS) {
    if (p.test(t)) return true;
  }
  return false;
}

function extractNotionErrorInfo(err) {
  if (!err) return null;
  const msg = String(err.message || err);
  const info = { message: msg };

  // Extract Notion-specific fields if present
  const codeMatch = msg.match(/code[:\s]+([A-Za-z_]+)/i);
  if (codeMatch) info.notionCode = codeMatch[1];

  const statusMatch = msg.match(/status[:\s]+(\d+)/i);
  if (statusMatch) info.httpStatus = Number(statusMatch[1]);

  const reqIdMatch = msg.match(/request[_\s]?id[:\s]+([a-f0-9-]+)/i);
  if (reqIdMatch) info.requestId = reqIdMatch[1];

  return info;
}

async function main() {
  hydrateProcessEnv();
  const args = parseArgs(process.argv);
  if (args.help || !args.dataset) {
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exitCode = 0;
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_TOKEN_LOCAL;
  if (!notionToken) throw new Error('NOTION_TOKEN missing');

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const datasetAbs = path.resolve(repoRoot, args.dataset);
  const rows = readJsonl(datasetAbs);
  const selected = Number.isFinite(args.limit) ? rows.slice(0, Math.max(1, Math.trunc(args.limit))) : rows;

  const tzDefault = args.tz || process.env.TG_TZ || 'Europe/Moscow';
  const nowIsoDefault = args.nowIso || new Date().toISOString();
  const modelDefault = args.model || process.env.TG_AI_MODEL || process.env.AI_MODEL || 'gpt-4.1';

  const tasksDbId =
    process.env.NOTION_TASKS_DB_ID ||
    process.env.NOTION_DATABASE_ID ||
    process.env.NOTION_DATABASE_ID_LOCAL ||
    '2d6535c900f08191a624d325f66dbe7c';
  const ideasDbId = process.env.NOTION_IDEAS_DB_ID || '2d6535c900f080ea88d9cd555af22068';
  const socialDbId = process.env.NOTION_SOCIAL_DB_ID || '2d6535c900f080929233d249e1247d06';
  const journalDbId = process.env.NOTION_JOURNAL_DB_ID || '86434dfd454448599233c1832542cf79';

  const runPrefix = buildRunPrefix({ basePrefix: args.prefix, datasetName: path.basename(args.dataset) });

  const pgPool = createPgPoolFromEnv(); // optional

  const notionHttp = createNotionHttpClient({ notionToken, eventLogRepo: null, component: 'notion' });
  const tasksRepo = new NotionTasksRepo({ notionToken, databaseId: tasksDbId, eventLogRepo: null });
  const ideasRepo = new NotionIdeasRepo({ notionToken, databaseId: ideasDbId, eventLogRepo: null });
  const socialRepo = new NotionSocialRepo({ notionToken, databaseId: socialDbId, eventLogRepo: null });
  const journalRepo = new NotionJournalRepo({ notionToken, databaseId: journalDbId, eventLogRepo: null });

  // Allowed categories for planner: fetch real Tags from Tasks DB (exclude Deprecated)
  let allowedCategories = ['Inbox', 'Work', 'Home', 'Personal', 'Everyday'];
  try {
    const opts = await tasksRepo.getOptions();
    const tags = Array.isArray(opts?.tags) ? opts.tags : [];
    allowedCategories = tags.filter((t) => String(t || '').trim().toLowerCase() !== 'deprecated');
  } catch {
    allowedCategories = ['Inbox', 'Work', 'Home', 'Personal', 'Everyday'];
  }

  // Tracking
  const created = {
    tasks: [], // { id, title }
    ideas: [],
    social: [],
    journal: [],
    prefs: [], // { chatId, key }
  };
  const createdIdSet = new Set();
  const domainById = new Map(); // id -> domain

  // Operation counters for full reporting
  const notionOps = {
    create: 0,
    update: 0,
    trash: 0,
    list: 0,
    query: 0,
    archive: 0,
  };
  const pgOps = {
    upsertPreference: 0,
    deletePreference: 0,
    insertSuggestion: 0,
  };

  // Patch repo instances to record created page ids (keep prototype methods intact)
  {
    const orig = tasksRepo.createTask.bind(tasksRepo);
    tasksRepo.createTask = async (payload) => {
      const r = await orig(payload);
      notionOps.create += 1;
      if (r?.id) {
        created.tasks.push({ id: r.id, title: r.title || null });
        createdIdSet.add(r.id);
        domainById.set(r.id, 'tasks');
      }
      return r;
    };
  }
  {
    const orig = ideasRepo.createIdea.bind(ideasRepo);
    ideasRepo.createIdea = async (payload) => {
      const r = await orig(payload);
      notionOps.create += 1;
      if (r?.id) {
        created.ideas.push({ id: r.id, title: r.title || null });
        createdIdSet.add(r.id);
        domainById.set(r.id, 'ideas');
      }
      return r;
    };
  }
  {
    const orig = socialRepo.createPost.bind(socialRepo);
    socialRepo.createPost = async (payload) => {
      const r = await orig(payload);
      notionOps.create += 1;
      if (r?.id) {
        created.social.push({ id: r.id, title: r.title || null });
        createdIdSet.add(r.id);
        domainById.set(r.id, 'social');
      }
      return r;
    };
  }
  {
    const orig = journalRepo.createEntry.bind(journalRepo);
    journalRepo.createEntry = async (payload) => {
      const r = await orig(payload);
      notionOps.create += 1;
      if (r?.id) {
        created.journal.push({ id: r.id, title: r.title || null });
        createdIdSet.add(r.id);
        domainById.set(r.id, 'journal');
      }
      return r;
    };
  }

  // In-memory state similar to bot runtime
  const pendingToolActionByChatId = new Map();
  const lastShownListByChatId = new Map();
  const lastShownIdeasListByChatId = new Map();
  const lastShownSocialListByChatId = new Map();
  const lastShownJournalListByChatId = new Map();

  const autoActions = [];
  const sentMessages = [];

  // Fake bot with full message capture
  const bot = {
    async sendMessage(chatId, text, opts) {
      const msg = { chatId, text: String(text || ''), opts: opts || null, ts: Date.now() };
      sentMessages.push(msg);
      const datas = extractInlineKeyboardCallbackData(opts);
      for (const d of datas) {
        // Decide what to auto-click:
        // - tool confirmations: confirm
        // - platform picks: pick first option
        // - task picks: pick first
        // - memory suggestion: accept
        if (d.startsWith('tool:confirm:') || d.startsWith('tool:cancel:') || d.startsWith('pick:') || d.startsWith('plat:') || d.startsWith('mem:accept:') || d.startsWith('mem:reject:')) {
          autoActions.push({ chatId, data: d });
        }
      }
      return { ok: true, message_id: sentMessages.length };
    },
    async answerCallbackQuery() {
      return { ok: true };
    },
    async editMessageText() {
      return { ok: true };
    },
  };

  function makeTasksBoardKey(chatId) {
    return chatId;
  }

  async function getTasksBoardModeForChat() {
    return 'main';
  }

  function renderAndRememberList({ chatId, tasks, title }) {
    const shown = (tasks || []).slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownListByChatId.set(makeTasksBoardKey(chatId), shown);
    bot.sendMessage(chatId, `${title}\n${shown.map((x) => `${x.index}. ${x.title}`).join('\n')}`);
    notionOps.list += 1;
  }

  function renderAndRememberIdeasList({ chatId, ideas, title }) {
    const shown = (ideas || []).slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownIdeasListByChatId.set(chatId, shown);
    bot.sendMessage(chatId, `${title}\n${shown.map((x) => `${x.index}. ${x.title}`).join('\n')}`);
    notionOps.list += 1;
  }

  function renderAndRememberSocialList({ chatId, posts, title }) {
    const shown = (posts || []).slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownSocialListByChatId.set(chatId, shown);
    bot.sendMessage(chatId, `${title}\n${shown.map((x) => `${x.index}. ${x.title}`).join('\n')}`);
    notionOps.list += 1;
  }

  function renderAndRememberJournalList({ chatId, entries, title }) {
    const shown = (entries || []).slice(0, 20).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
    lastShownJournalListByChatId.set(chatId, shown);
    bot.sendMessage(chatId, `${title}\n${shown.map((x) => `${x.index}. ${x.title}`).join('\n')}`);
    notionOps.list += 1;
  }

  function resolveJournalPageIdFromLastShown({ chatId, text }) {
    const t = String(text || '').toLowerCase();
    const m = t.match(/(?:^|\\D)(\\d{1,2})(?:\\D|$)/);
    const idx = m ? Number(m[1]) : null;
    if (!idx) return null;
    const list = lastShownJournalListByChatId.get(chatId) || [];
    const found = list.find((x) => x.index === idx);
    return found?.id || null;
  }

  const { executeToolPlan } = createToolExecutor({
    bot,
    tasksRepo,
    tasksRepoTest: null,
    getTasksBoardModeForChat,
    makeTasksBoardKey,
    ideasRepo,
    socialRepo,
    journalRepo,
    tz: tzDefault,
    pendingToolActionByChatId,
    lastShownListByChatId,
    lastShownIdeasListByChatId,
    lastShownSocialListByChatId,
    renderAndRememberList,
    renderAndRememberIdeasList,
    renderAndRememberSocialList,
    renderAndRememberJournalList,
    resolveJournalPageIdFromLastShown,
    eventLogRepo: null,
  });

  const handleCallbackQuery = createCallbackQueryHandler({
    bot,
    tasksRepo,
    tasksRepoTest: null,
    resolveTasksRepoByMode: null,
    ideasRepo,
    socialRepo,
    journalRepo,
    pendingToolActionByChatId,
    executeToolPlan,
    confirmAiDraft: null,
    cancelAiDraft: null,
    clearTimer: () => {},
    timers: new Map(),
    pendingTask: new Map(),
    taskTextById: new Map(),
    waitingFor: new Map(),
    DATE_CATEGORIES: [],
    notionRepo: tasksRepo,
    chatSecurity: null,
    pgPool,
    eventLogRepo: null,
  });

  function pickKnownIdForTool(toolName) {
    if (toolName === 'notion.update_task' || toolName === 'notion.mark_done' || toolName === 'notion.move_to_deprecated' || toolName === 'notion.append_description') {
      return created.tasks.length ? created.tasks[created.tasks.length - 1].id : null;
    }
    if (toolName === 'notion.update_idea' || toolName === 'notion.archive_idea') {
      return created.ideas.length ? created.ideas[created.ideas.length - 1].id : null;
    }
    if (toolName === 'notion.update_social_post' || toolName === 'notion.archive_social_post') {
      return created.social.length ? created.social[created.social.length - 1].id : null;
    }
    if (toolName === 'notion.update_journal_entry' || toolName === 'notion.archive_journal_entry') {
      return created.journal.length ? created.journal[created.journal.length - 1].id : null;
    }
    return null;
  }

  // Collect agent messages for current case
  function collectAgentMessages(startIdx) {
    const msgs = [];
    for (let i = startIdx; i < sentMessages.length; i++) {
      msgs.push({ text: sentMessages[i].text, ts: sentMessages[i].ts });
    }
    return msgs;
  }

  async function drainAutoActions({ opCounter, reportItem }) {
    while (autoActions.length) {
      const act = autoActions.shift();
      const data = act.data;
      const chatId = act.chatId;

      if (data.startsWith('tool:confirm:')) {
        const pending = pendingToolActionByChatId.get(chatId) || null;
        const kind = pending?.kind || null;
        const pageId = pending?.payload?.pageId || null;

        // Safety gate: confirm only for records created in this run.
        // This prevents accidental updates to real user data.
        const isWrite =
          kind === 'notion.update_task' ||
          kind === 'notion.mark_done' ||
          kind === 'notion.move_to_deprecated' ||
          kind === 'notion.append_description' ||
          kind === 'notion.update_idea' ||
          kind === 'notion.archive_idea' ||
          kind === 'notion.update_social_post' ||
          kind === 'notion.archive_social_post' ||
          kind === 'notion.update_journal_entry' ||
          kind === 'notion.archive_journal_entry';

        if (isWrite && pageId && !createdIdSet.has(pageId)) {
          // Cancel unsafe confirmation
          const cancelData = data.replace('tool:confirm:', 'tool:cancel:');
          reportItem.actions.push({ type: 'auto_cancel_unsafe', kind, pageId });
          await handleCallbackQuery({
            id: `q_${Date.now()}_${Math.random()}`,
            data: cancelData,
            message: { chat: { id: chatId }, message_id: 1 },
            from: { username: 'e2e' },
          });
        } else {
          reportItem.actions.push({ type: 'auto_confirm', kind, pageId });
          await handleCallbackQuery({
            id: `q_${Date.now()}_${Math.random()}`,
            data,
            message: { chat: { id: chatId }, message_id: 1 },
            from: { username: 'e2e' },
          });
          if (isWrite) notionOps.update += 1;
        }
        opCounter.count += 1;
        await sleep(args.opSleepMs);
      } else if (data.startsWith('plat:')) {
        // Pick first platform option (index 0)
        const parts = data.split(':');
        const actionId = parts[1] || '';
        const pickData = `plat:${actionId}:0`;
        reportItem.actions.push({ type: 'auto_pick_platform', actionId });
        await handleCallbackQuery({
          id: `q_${Date.now()}_${Math.random()}`,
          data: pickData,
          message: { chat: { id: chatId }, message_id: 1 },
          from: { username: 'e2e' },
        });
        opCounter.count += 1;
        await sleep(args.opSleepMs);
      } else if (data.startsWith('pick:')) {
        // Pick first candidate
        const pickData = 'pick:1';
        reportItem.actions.push({ type: 'auto_pick_candidate' });
        await handleCallbackQuery({
          id: `q_${Date.now()}_${Math.random()}`,
          data: pickData,
          message: { chat: { id: chatId }, message_id: 1 },
          from: { username: 'e2e' },
        });
        opCounter.count += 1;
        await sleep(args.opSleepMs);
      } else if (data.startsWith('mem:accept:')) {
        reportItem.actions.push({ type: 'auto_mem_accept' });
        await handleCallbackQuery({
          id: `q_${Date.now()}_${Math.random()}`,
          data,
          message: { chat: { id: chatId }, message_id: 1 },
          from: { username: 'e2e' },
        });
        pgOps.upsertPreference += 1;
        opCounter.count += 1;
        await sleep(args.opSleepMs);
      }

      if (args.batchEvery && opCounter.count > 0 && opCounter.count % args.batchEvery === 0) {
        await sleep(args.batchSleepMs);
      }
    }
  }

  async function runMutationSweep({ chatId, caseId }) {
    if (!args.mutation) return;
    // Execute a small set of extra tool operations on the latest created item per domain.
    // This increases coverage of executor + Notion behavior without requiring extra userText cases.
    const latestTask = created.tasks.length ? created.tasks[created.tasks.length - 1].id : null;
    const latestIdea = created.ideas.length ? created.ideas[created.ideas.length - 1].id : null;
    const latestSocial = created.social.length ? created.social[created.social.length - 1].id : null;
    const latestJournal = created.journal.length ? created.journal[created.journal.length - 1].id : null;

    const ops = [];
    if (latestTask) {
      ops.push({ toolName: 'notion.update_task', args: { pageId: latestTask, status: 'Done', priority: 'High', tag: 'Work' }, userText: `e2e mutate task ${caseId}` });
      ops.push({ toolName: 'notion.append_description', args: { pageId: latestTask, text: `${runPrefix} extra description ${caseId}` }, userText: `e2e mutate task desc ${caseId}` });
      ops.push({ toolName: 'notion.list_tasks', args: { queryText: sanitizePrefixText(runPrefix) }, userText: `покажи задачи по ${sanitizePrefixText(runPrefix)}` });
    }
    if (latestIdea) {
      ops.push({ toolName: 'notion.update_idea', args: { pageId: latestIdea, title: `${runPrefix} idea title update ${caseId}`, tags: ['Dev'] }, userText: `e2e mutate idea ${caseId}` });
      ops.push({ toolName: 'notion.find_ideas', args: { queryText: sanitizePrefixText(runPrefix) }, userText: `найди идеи ${sanitizePrefixText(runPrefix)}` });
    }
    if (latestSocial) {
      ops.push({ toolName: 'notion.update_social_post', args: { pageId: latestSocial, status: 'Draft' }, userText: `e2e mutate social ${caseId}` });
      ops.push({ toolName: 'notion.find_social_posts', args: { queryText: sanitizePrefixText(runPrefix) }, userText: `найди посты ${sanitizePrefixText(runPrefix)}` });
    }
    if (latestJournal) {
      ops.push({ toolName: 'notion.update_journal_entry', args: { pageId: latestJournal, mood: 4, energy: 3, description: `${runPrefix} journal update ${caseId}` }, userText: `e2e mutate journal ${caseId}` });
      ops.push({ toolName: 'notion.find_journal_entries', args: { queryText: sanitizePrefixText(runPrefix) }, userText: `найди в дневнике ${sanitizePrefixText(runPrefix)}` });
    }

    for (const op of ops) {
      await executeToolPlan({ chatId, from: 'e2e', toolName: op.toolName, args: op.args, userText: op.userText });
      await drainAutoActions({ opCounter: { count: 0 }, reportItem: { actions: [] } });
      notionOps.update += 1;
      await sleep(args.opSleepMs);
    }
  }

  async function maybeCreateAndAcceptPrefSuggestion({ chatId, caseId, userText }) {
    // We cannot reuse the exact nested function from todo_bot.js here without re-instantiating the full bot.
    // Instead, we simulate the same DB path as the callback handler: create a suggestion row, then accept it.
    if (!pgPool) return false;
    const low = String(userText || '').toLowerCase();
    if (!low.includes('запомни') && !low.includes('в память') && !low.includes('preference')) return false;

    // Create a memory suggestion row directly in Postgres
    const prefKey = `e2e.${sanitizePrefixText(runPrefix).replace(/[^\p{L}\p{N}._-]+/gu, '_')}.${caseId}.note`;
    const valueHuman = withPrefixedTitle({ prefix: runPrefix, caseId, title: userText });
    const candidate = {
      key: prefKey,
      scope: 'global',
      category: 'memory_note',
      value_human: valueHuman,
      value_json: { type: 'memory_note', text: valueHuman, source: 'e2e' },
      confidence: 1.0,
      reason: 'e2e runner synthetic memory suggestion',
    };

    // Insert into memory_suggestions in a compatible shape (see infra/db/migrations/007_memory_suggestions.sql)
    let suggestionId = null;
    try {
      const q =
        "INSERT INTO memory_suggestions (chat_id, kind, candidate, candidate_hash, status, source_message_id) VALUES ($1, 'preference', $2::jsonb, md5($3), $4, $5) RETURNING id";
      const res = await pgPool.query(q, [chatId, JSON.stringify(candidate), JSON.stringify(candidate), 'pending', null]);
      suggestionId = Number(res?.rows?.[0]?.id);
      pgOps.insertSuggestion += 1;
    } catch {
      return false;
    }
    if (!Number.isFinite(suggestionId)) return false;

    // Trigger the same accept path via callback handler
    try {
      await handleCallbackQuery({
        id: `q_${Date.now()}_${Math.random()}`,
        data: `mem:accept:${suggestionId}`,
        message: { chat: { id: chatId }, message_id: 1 },
        from: { username: 'e2e' },
      });
      created.prefs.push({ chatId, key: prefKey });
      pgOps.upsertPreference += 1;
    } catch (e) {
      // Duplicate key or other DB error - skip gracefully
      // eslint-disable-next-line no-console
      console.log(`[memory] Skipped suggestion ${suggestionId}: ${e?.code || e?.message || 'error'}`);
    }
    await sleep(args.opSleepMs);
    return true;
  }

  const report = {
    createdAt: new Date().toISOString(),
    dataset: args.dataset,
    datasetAbsPath: datasetAbs,
    runPrefix,
    model: modelDefault,
    tz: tzDefault,
    nowIso: nowIsoDefault,
    chatId: args.chatId,
    cleanupMode: args.trashOnly ? 'trash' : 'archive',
    summary: {
      total: 0,
      plannerOk: 0,
      plannerError: 0,
      toolPlanned: 0,
      toolExecuted: 0,
      toolSkippedUnsafe: 0,
      hardError: 0,
      softError: 0,
      chatResponses: 0,
      cleanupTrashed: 0,
      cleanupArchived: 0,
      cleanupErrors: 0,
      pgCleanupDeleted: 0,
    },
    notionOps,
    pgOps,
    createdCounts: { tasks: 0, ideas: 0, social: 0, journal: 0, prefs: 0 },
    cases: [],
  };

  const opCounter = { count: 0 };

  const totalCases = selected.length;
  let processedCases = 0;

  for (const row of selected) {
    const c = isPlainObject(row.obj) ? row.obj : {};
    const caseId = c.id ? String(c.id) : `line_${row.lineNo}`;
    const userText = String(c.userText || '');
    const tz = c.tz ? String(c.tz) : tzDefault;
    const nowIso = c.nowIso ? String(c.nowIso) : nowIsoDefault;

    processedCases += 1;
    // eslint-disable-next-line no-console
    console.log(`[${processedCases}/${totalCases}] Case ${caseId}: ${userText.slice(0, 60)}${userText.length > 60 ? '...' : ''}`);

    const msgStartIdx = sentMessages.length;

    const reportItem = {
      id: caseId,
      lineNo: row.lineNo,
      userText,
      plan: null,
      status: 'error',
      error: null,
      agentMessages: [],
      actions: [],
    };

    report.summary.total += 1;

    let plan = null;
    try {
      plan = await planAgentAction({
        apiKey,
        model: c.model ? String(c.model) : modelDefault,
        userText,
        allowedCategories: Array.isArray(c.allowedCategories) ? c.allowedCategories : allowedCategories,
        lastShownList: Array.isArray(c.lastShownList) ? c.lastShownList : lastShownListByChatId.get(makeTasksBoardKey(args.chatId)) || undefined,
        lastShownIdeasList: Array.isArray(c.lastShownIdeasList) ? c.lastShownIdeasList : lastShownIdeasListByChatId.get(args.chatId) || undefined,
        lastShownSocialList: Array.isArray(c.lastShownSocialList) ? c.lastShownSocialList : lastShownSocialListByChatId.get(args.chatId) || undefined,
        tz,
        nowIso,
        memorySummary: c.memorySummary ? String(c.memorySummary) : undefined,
        chatSummary: c.chatSummary ? String(c.chatSummary) : undefined,
        chatHistory: c.chatHistory ? String(c.chatHistory) : undefined,
        workContext: c.workContext ? String(c.workContext) : undefined,
      });
      report.summary.plannerOk += 1;
      reportItem.plan = plan;
      reportItem.status = 'planned';
    } catch (e) {
      report.summary.plannerError += 1;
      report.summary.hardError += 1;
      reportItem.status = 'planner_error';
      reportItem.error = extractNotionErrorInfo(e);
      reportItem.agentMessages = collectAgentMessages(msgStartIdx);
      report.cases.push(reportItem);
      await sleep(args.llmSleepMs);
      continue;
    }

    await sleep(args.llmSleepMs);

    if (plan?.type !== 'tool' || !plan?.tool?.name) {
      // Chat plan: we still test Postgres by injecting memory suggestion flow when relevant.
      reportItem.status = 'chat';
      report.summary.chatResponses += 1;
      await maybeCreateAndAcceptPrefSuggestion({ chatId: args.chatId, caseId, userText });
      reportItem.agentMessages = collectAgentMessages(msgStartIdx);
      report.cases.push(reportItem);
      continue;
    }

    const toolName = String(plan.tool.name);
    const rawArgs = isPlainObject(plan.tool.args) ? plan.tool.args : {};
    report.summary.toolPlanned += 1;

    // Prefix create operations and keep everything isolated.
    let execArgs = { ...rawArgs };
    if (toolName === 'notion.create_task') {
      const title = rawArgs.title ? String(rawArgs.title) : summarizeTextShort(userText, 42) || 'task';
      execArgs.title = withPrefixedTitle({ prefix: runPrefix, caseId, title });
    }
    if (toolName === 'notion.create_idea') {
      const title = rawArgs.title ? String(rawArgs.title) : summarizeTextShort(userText, 42) || 'idea';
      execArgs.title = withPrefixedTitle({ prefix: runPrefix, caseId, title });
    }
    if (toolName === 'notion.create_social_post') {
      const title = rawArgs.title ? String(rawArgs.title) : summarizeTextShort(userText, 42) || 'post';
      execArgs.title = withPrefixedTitle({ prefix: runPrefix, caseId, title });
    }
    if (toolName === 'notion.create_journal_entry') {
      const title = rawArgs.title ? String(rawArgs.title) : summarizeTextShort(userText, 42) || 'journal';
      execArgs.title = withPrefixedTitle({ prefix: runPrefix, caseId, title });
    }

    // Safety routing for write tools: force target pageId to a record created in this run.
    const isWriteTool =
      toolName === 'notion.update_task' ||
      toolName === 'notion.mark_done' ||
      toolName === 'notion.move_to_deprecated' ||
      toolName === 'notion.append_description' ||
      toolName === 'notion.update_idea' ||
      toolName === 'notion.archive_idea' ||
      toolName === 'notion.update_social_post' ||
      toolName === 'notion.archive_social_post' ||
      toolName === 'notion.update_journal_entry' ||
      toolName === 'notion.archive_journal_entry';

    if (isWriteTool) {
      const candidateId = execArgs.pageId ? String(execArgs.pageId) : null;
      if (!candidateId || !createdIdSet.has(candidateId)) {
        const forced = pickKnownIdForTool(toolName);
        if (forced) {
          execArgs = { ...execArgs, pageId: forced, taskIndex: undefined, queryText: undefined };
          reportItem.actions.push({ type: 'force_page_id', toolName, pageId: forced });
        } else {
          report.summary.toolSkippedUnsafe += 1;
          reportItem.status = 'skipped_no_target';
          reportItem.agentMessages = collectAgentMessages(msgStartIdx);
          report.cases.push(reportItem);
          continue;
        }
      }
    }

    try {
      await executeToolPlan({ chatId: args.chatId, from: 'e2e', toolName, args: execArgs, userText });
      report.summary.toolExecuted += 1;
      reportItem.status = 'executed';
      opCounter.count += 1;
      await sleep(args.opSleepMs);

      await drainAutoActions({ opCounter, reportItem });

      // Mutation sweep (mode B) after create
      if (toolName === 'notion.create_task' || toolName === 'notion.create_idea' || toolName === 'notion.create_social_post' || toolName === 'notion.create_journal_entry') {
        await runMutationSweep({ chatId: args.chatId, caseId });
      }

      // Collect agent messages and check for soft errors
      reportItem.agentMessages = collectAgentMessages(msgStartIdx);
      const hasSoftError = reportItem.agentMessages.some((m) => detectSoftError(m.text));
      if (hasSoftError) {
        reportItem.status = 'soft_error';
        report.summary.softError += 1;
      }
    } catch (e) {
      report.summary.hardError += 1;
      reportItem.status = 'hard_error';
      reportItem.error = extractNotionErrorInfo(e);
      reportItem.agentMessages = collectAgentMessages(msgStartIdx);
    }

    report.cases.push(reportItem);

    if (args.batchEvery && opCounter.count > 0 && opCounter.count % args.batchEvery === 0) {
      await sleep(args.batchSleepMs);
    }
  }

  // Cleanup: trash (in_trash:true) or archive (archived:true) for all created pages.
  if (args.cleanup) {
    // Tasks: trash/archive via Notion pages API
    for (const it of created.tasks) {
      if (!it?.id) continue;
      try {
        const payload = args.trashOnly ? { in_trash: true } : { archived: true };
        // eslint-disable-next-line no-await-in-loop
        await notionHttp.patch(`pages/${String(it.id)}`, payload);
        if (args.trashOnly) {
          report.summary.cleanupTrashed += 1;
          notionOps.trash += 1;
        } else {
          report.summary.cleanupArchived += 1;
          notionOps.archive += 1;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(args.opSleepMs);
      } catch (e) {
        report.summary.cleanupErrors += 1;
        // eslint-disable-next-line no-console
        console.error(`cleanup error (task ${it.id}):`, e?.message || e);
      }
    }

    // Ideas: trash/archive via Notion pages API (repos use archived, we use direct API for trash)
    for (const it of created.ideas) {
      if (!it?.id) continue;
      try {
        if (args.trashOnly) {
          // eslint-disable-next-line no-await-in-loop
          await notionHttp.patch(`pages/${String(it.id)}`, { in_trash: true });
          report.summary.cleanupTrashed += 1;
          notionOps.trash += 1;
        } else {
          // eslint-disable-next-line no-await-in-loop
          await ideasRepo.archiveIdea({ pageId: String(it.id) });
          report.summary.cleanupArchived += 1;
          notionOps.archive += 1;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(args.opSleepMs);
      } catch (e) {
        report.summary.cleanupErrors += 1;
        // eslint-disable-next-line no-console
        console.error(`cleanup error (idea ${it.id}):`, e?.message || e);
      }
    }

    // Social: trash/archive
    for (const it of created.social) {
      if (!it?.id) continue;
      try {
        if (args.trashOnly) {
          // eslint-disable-next-line no-await-in-loop
          await notionHttp.patch(`pages/${String(it.id)}`, { in_trash: true });
          report.summary.cleanupTrashed += 1;
          notionOps.trash += 1;
        } else {
          // eslint-disable-next-line no-await-in-loop
          await socialRepo.archivePost({ pageId: String(it.id) });
          report.summary.cleanupArchived += 1;
          notionOps.archive += 1;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(args.opSleepMs);
      } catch (e) {
        report.summary.cleanupErrors += 1;
        // eslint-disable-next-line no-console
        console.error(`cleanup error (social ${it.id}):`, e?.message || e);
      }
    }

    // Journal: trash/archive
    for (const it of created.journal) {
      if (!it?.id) continue;
      try {
        if (args.trashOnly) {
          // eslint-disable-next-line no-await-in-loop
          await notionHttp.patch(`pages/${String(it.id)}`, { in_trash: true });
          report.summary.cleanupTrashed += 1;
          notionOps.trash += 1;
        } else {
          // eslint-disable-next-line no-await-in-loop
          await journalRepo.archiveEntry({ pageId: String(it.id) });
          report.summary.cleanupArchived += 1;
          notionOps.archive += 1;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(args.opSleepMs);
      } catch (e) {
        report.summary.cleanupErrors += 1;
        // eslint-disable-next-line no-console
        console.error(`cleanup error (journal ${it.id}):`, e?.message || e);
      }
    }

    // Postgres cleanup: delete only our test preferences by key prefix
    if (pgPool && created.prefs.length) {
      const keys = created.prefs.map((x) => x.key).filter(Boolean);
      try {
        // eslint-disable-next-line no-await-in-loop
        const del1 = await pgPool.query('DELETE FROM preferences WHERE chat_id = $1 AND pref_key = ANY($2::text[])', [args.chatId, keys]);
        // eslint-disable-next-line no-await-in-loop
        const del2 = await pgPool.query('DELETE FROM preferences_sync WHERE chat_id = $1 AND pref_key = ANY($2::text[])', [args.chatId, keys]);
        report.summary.pgCleanupDeleted += Number(del1?.rowCount || 0) + Number(del2?.rowCount || 0);
        pgOps.deletePreference += Number(del1?.rowCount || 0) + Number(del2?.rowCount || 0);
      } catch {
        // ignore
      }
    }
  }

  report.createdCounts.tasks = created.tasks.length;
  report.createdCounts.ideas = created.ideas.length;
  report.createdCounts.social = created.social.length;
  report.createdCounts.journal = created.journal.length;
  report.createdCounts.prefs = created.prefs.length;

  // Write report
  const outDefault = path.join(repoRoot, 'data', 'evals', `e2e-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const outPath = args.out ? path.resolve(repoRoot, args.out) : outDefault;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  if (pgPool) {
    await pgPool.end().catch(() => {});
  }

  // Print summary to console
  // eslint-disable-next-line no-console
  console.log('\n=== E2E Run Summary ===');
  // eslint-disable-next-line no-console
  console.log(`Dataset: ${args.dataset}`);
  // eslint-disable-next-line no-console
  console.log(`Prefix: ${runPrefix}`);
  // eslint-disable-next-line no-console
  console.log(`Cleanup mode: ${args.trashOnly ? 'TRASH (in_trash:true)' : 'ARCHIVE (archived:true)'}`);
  // eslint-disable-next-line no-console
  console.log(`\nCases: ${report.summary.total}`);
  // eslint-disable-next-line no-console
  console.log(`  - Planner OK: ${report.summary.plannerOk}`);
  // eslint-disable-next-line no-console
  console.log(`  - Planner Error: ${report.summary.plannerError}`);
  // eslint-disable-next-line no-console
  console.log(`  - Tool Planned: ${report.summary.toolPlanned}`);
  // eslint-disable-next-line no-console
  console.log(`  - Tool Executed: ${report.summary.toolExecuted}`);
  // eslint-disable-next-line no-console
  console.log(`  - Skipped (no target): ${report.summary.toolSkippedUnsafe}`);
  // eslint-disable-next-line no-console
  console.log(`  - Hard Errors: ${report.summary.hardError}`);
  // eslint-disable-next-line no-console
  console.log(`  - Soft Errors: ${report.summary.softError}`);
  // eslint-disable-next-line no-console
  console.log(`  - Chat Responses: ${report.summary.chatResponses}`);
  // eslint-disable-next-line no-console
  console.log(`\nCreated: tasks=${report.createdCounts.tasks}, ideas=${report.createdCounts.ideas}, social=${report.createdCounts.social}, journal=${report.createdCounts.journal}, prefs=${report.createdCounts.prefs}`);
  // eslint-disable-next-line no-console
  console.log(`\nNotion Ops: create=${notionOps.create}, update=${notionOps.update}, list=${notionOps.list}, trash=${notionOps.trash}, archive=${notionOps.archive}`);
  // eslint-disable-next-line no-console
  console.log(`PG Ops: upsert=${pgOps.upsertPreference}, delete=${pgOps.deletePreference}, suggestions=${pgOps.insertSuggestion}`);
  // eslint-disable-next-line no-console
  console.log(`\nCleanup: trashed=${report.summary.cleanupTrashed}, archived=${report.summary.cleanupArchived}, errors=${report.summary.cleanupErrors}, pg_deleted=${report.summary.pgCleanupDeleted}`);
  // eslint-disable-next-line no-console
  console.log(`\nReport: ${outPath}`);
  // eslint-disable-next-line no-console
  console.log('=======================\n');

  process.exitCode = report.summary.hardError || report.summary.plannerError ? 2 : 0;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('e2e fatal error', e);
  process.exitCode = 1;
});

