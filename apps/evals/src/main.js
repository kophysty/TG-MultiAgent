const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { hydrateProcessEnv } = require('../../../core/runtime/env');
const { planAgentAction } = require('../../../core/ai/agent_planner');
const { NotionTasksRepo } = require('../../../core/connectors/notion/tasks_repo');

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex');
}

function makeId(prefix, payload) {
  return `${prefix}_${md5(JSON.stringify(payload || {})).slice(0, 8)}`;
}

function parseArgs(argv) {
  const out = {
    dataset: null,
    limit: null,
    outPath: null,
    model: null,
    tz: null,
    nowIso: null,
    categoriesFromNotion: false,
    tasksDbId: null,
    onlyMismatch: false,
    failFast: false,
    sleepMs: 0,
    retries: 6,
    retryBaseMs: 1500,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset' && argv[i + 1]) out.dataset = String(argv[++i]);
    if (a === '--limit' && argv[i + 1]) out.limit = Number(argv[++i]);
    if (a === '--out' && argv[i + 1]) out.outPath = String(argv[++i]);
    if (a === '--model' && argv[i + 1]) out.model = String(argv[++i]);
    if (a === '--tz' && argv[i + 1]) out.tz = String(argv[++i]);
    if (a === '--now-iso' && argv[i + 1]) out.nowIso = String(argv[++i]);
    if (a === '--categories-from-notion') out.categoriesFromNotion = true;
    if (a === '--tasks-db-id' && argv[i + 1]) out.tasksDbId = String(argv[++i]);
    if (a === '--only-mismatch') out.onlyMismatch = true;
    if (a === '--fail-fast') out.failFast = true;
    if (a === '--sleep-ms' && argv[i + 1]) out.sleepMs = Number(argv[++i]);
    if (a === '--retries' && argv[i + 1]) out.retries = Number(argv[++i]);
    if (a === '--retry-base-ms' && argv[i + 1]) out.retryBaseMs = Number(argv[++i]);
    if (a === '--help' || a === '-h') out.help = true;
  }

  return out;
}

function usage() {
  return [
    'Usage:',
    '  node apps/evals/src/main.js --dataset <path.jsonl> [options]',
    '',
    'Options:',
    '  --dataset <path>             Path to jsonl dataset (required)',
    '  --limit <N>                  Run only first N cases',
    '  --out <path>                 Write report json to this path (default: data/evals/report-<ts>.json)',
    '  --model <name>               Override TG_AI_MODEL for planner (default: env TG_AI_MODEL or gpt-4.1)',
    '  --tz <IANA>                  Override timezone per run (default: env TG_TZ or Europe/Moscow)',
    '  --now-iso <iso>              Override nowIso (default: current time)',
    '  --categories-from-notion     Fetch allowedCategories from Notion Tasks DB (requires NOTION_TOKEN)',
    '  --tasks-db-id <id>           Override Tasks DB id for categories-from-notion',
    '  --only-mismatch              Report only mismatches and errors',
    '  --fail-fast                  Stop on first mismatch or error',
    '  --sleep-ms <ms>              Sleep between planner calls (helps avoid rate limits). Default 0.',
    '  --retries <N>                Retries for retryable errors (429/5xx/network). Default 6.',
    '  --retry-base-ms <ms>         Base backoff in ms for retries. Default 1500.',
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

function deepPartialMatch(expected, actual, pathParts = [], opts = {}) {
  // expected is a partial shape that must be satisfied by actual
  if (expected === null || expected === undefined) return { ok: expected === actual, diffs: expected === actual ? [] : [{ path: pathParts.join('.'), expected, actual }] };

  const ignoreCasePaths = Array.isArray(opts.ignoreCasePaths) ? opts.ignoreCasePaths : [];
  const pathKey = pathParts.join('.');

  // Special matcher: regex
  if (isPlainObject(expected) && Object.prototype.hasOwnProperty.call(expected, '$regex')) {
    const pattern = String(expected.$regex || '');
    const flags = expected.$flags ? String(expected.$flags) : '';
    const str = typeof actual === 'string' ? actual : actual === null || actual === undefined ? '' : String(actual);
    let re = null;
    try {
      re = new RegExp(pattern, flags);
    } catch (e) {
      return { ok: false, diffs: [{ path: pathKey, expected, actual: str, error: `bad regex: ${String(e?.message || e)}` }] };
    }
    const ok = re.test(str);
    return { ok, diffs: ok ? [] : [{ path: pathKey, expected, actual: str }] };
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return { ok: false, diffs: [{ path: pathParts.join('.'), expected, actual }] };
    const diffs = [];
    const len = expected.length;
    for (let i = 0; i < len; i++) {
      const r = deepPartialMatch(expected[i], actual[i], [...pathParts, String(i)], opts);
      if (!r.ok) diffs.push(...r.diffs);
    }
    return { ok: diffs.length === 0, diffs };
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return { ok: false, diffs: [{ path: pathParts.join('.'), expected, actual }] };
    const diffs = [];
    for (const k of Object.keys(expected)) {
      const r = deepPartialMatch(expected[k], actual[k], [...pathParts, k], opts);
      if (!r.ok) diffs.push(...r.diffs);
    }
    return { ok: diffs.length === 0, diffs };
  }

  if (ignoreCasePaths.includes(pathKey) && typeof expected === 'string') {
    const a = typeof actual === 'string' ? actual : actual === null || actual === undefined ? '' : String(actual);
    const ok = String(expected).toLowerCase() === String(a).toLowerCase();
    return { ok, diffs: ok ? [] : [{ path: pathKey, expected, actual }] };
  }

  return { ok: expected === actual, diffs: expected === actual ? [] : [{ path: pathKey, expected, actual }] };
}

function normalizeExpected(e) {
  const exp = isPlainObject(e) ? e : {};
  const type = exp.type === 'chat' || exp.type === 'tool' ? exp.type : null;
  const typeAnyOf = Array.isArray(exp.typeAnyOf)
    ? exp.typeAnyOf.map((x) => String(x || '')).filter((x) => x === 'chat' || x === 'tool')
    : null;
  const toolName = exp.toolName ? String(exp.toolName) : exp.tool && exp.tool.name ? String(exp.tool.name) : null;
  const toolNameAnyOf = Array.isArray(exp.toolNameAnyOf)
    ? exp.toolNameAnyOf.map((x) => String(x || '')).filter((x) => x)
    : null;
  const args = exp.args && typeof exp.args === 'object' ? exp.args : exp.tool && exp.tool.args && typeof exp.tool.args === 'object' ? exp.tool.args : null;
  const argsAnyOf = Array.isArray(exp.argsAnyOf) ? exp.argsAnyOf.filter((x) => isPlainObject(x)) : null;
  const chatContains = exp.chatContains ? String(exp.chatContains) : null;
  const compare = isPlainObject(exp.compare) ? exp.compare : null;
  return { type, typeAnyOf, toolName, toolNameAnyOf, args, argsAnyOf, chatContains, compare };
}

function comparePlan({ expected, actual }) {
  const exp = normalizeExpected(expected);
  const out = { ok: true, reasons: [], diffs: [] };
  const compareOpts = exp.compare && Array.isArray(exp.compare.ignoreCasePaths) ? { ignoreCasePaths: exp.compare.ignoreCasePaths } : {};

  if (exp.type && exp.type !== actual?.type) {
    out.ok = false;
    out.reasons.push(`type mismatch: expected ${exp.type}, got ${actual?.type}`);
  }
  if (exp.typeAnyOf && exp.typeAnyOf.length) {
    const got = actual?.type ? String(actual.type) : null;
    if (!got || !exp.typeAnyOf.includes(got)) {
      out.ok = false;
      out.reasons.push(`type mismatch: expected anyOf ${exp.typeAnyOf.join(', ')}, got ${got}`);
    }
  }

  if (exp.type === 'tool' || exp.toolName) {
    const gotTool = actual?.tool?.name ? String(actual.tool.name) : null;
    if (exp.toolName && exp.toolName !== gotTool) {
      out.ok = false;
      out.reasons.push(`tool.name mismatch: expected ${exp.toolName}, got ${gotTool}`);
    }
    if (exp.toolNameAnyOf && exp.toolNameAnyOf.length) {
      if (!gotTool || !exp.toolNameAnyOf.includes(gotTool)) {
        out.ok = false;
        out.reasons.push(`tool.name mismatch: expected anyOf ${exp.toolNameAnyOf.join(', ')}, got ${gotTool}`);
      }
    }
    const actualArgs = actual?.tool?.args || {};
    if (exp.argsAnyOf && exp.argsAnyOf.length) {
      let best = null;
      for (const variant of exp.argsAnyOf) {
        const r = deepPartialMatch(variant, actualArgs, ['tool', 'args'], compareOpts);
        if (r.ok) {
          best = { ok: true, diffs: [] };
          break;
        }
        if (!best || (r.diffs || []).length < (best.diffs || []).length) best = r;
      }
      if (!best || !best.ok) {
        out.ok = false;
        out.reasons.push('tool.args mismatch');
        out.diffs.push(...((best && best.diffs) || []));
      }
    } else if (exp.args) {
      const r = deepPartialMatch(exp.args, actualArgs, ['tool', 'args'], compareOpts);
      if (!r.ok) {
        out.ok = false;
        out.reasons.push('tool.args mismatch');
        out.diffs.push(...r.diffs);
      }
    }
  }

  if (exp.type === 'chat' || exp.chatContains) {
    const msg = actual?.chat?.message ? String(actual.chat.message) : '';
    if (exp.chatContains && !msg.includes(exp.chatContains)) {
      out.ok = false;
      out.reasons.push('chat.message does not contain expected substring');
      out.diffs.push({ path: 'chat.message', expected: exp.chatContains, actual: msg });
    }
  }

  return out;
}

async function getAllowedCategories({ notionToken, tasksDbId }) {
  if (!notionToken || !tasksDbId) return null;
  const repo = new NotionTasksRepo({ notionToken, databaseId: tasksDbId, eventLogRepo: null });
  const opts = await repo.getOptions();
  const tags = Array.isArray(opts?.tags) ? opts.tags : [];
  return tags.filter((t) => String(t || '').trim().toLowerCase() !== 'deprecated');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRetryablePlannerError(e) {
  const code = String(e?.code || '').trim().toUpperCase();
  const msg = String(e?.message || '').toLowerCase();
  const status = e?.response?.status || null;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
  if (msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('econnreset')) return true;
  return false;
}

async function planWithRetry({ makePlanFn, retries, baseMs, sleepMs }) {
  const maxAttempts = Math.max(1, Math.min(20, Number(retries) || 1)) + 1;
  const base = Math.max(0, Number(baseMs) || 0);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await makePlanFn();
      if (sleepMs) await sleep(sleepMs);
      return res;
    } catch (e) {
      const retryable = isRetryablePlannerError(e);
      if (!retryable || attempt >= maxAttempts) throw e;
      // Exponential backoff with cap.
      const wait = Math.min(60_000, base ? base * Math.pow(1.6, attempt - 1) : 0);
      if (wait) await sleep(wait);
    }
  }
  // unreachable
  return null;
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

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const datasetPath = path.resolve(repoRoot, args.dataset);
  const rows = readJsonl(datasetPath);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const tzDefault = args.tz || process.env.TG_TZ || 'Europe/Moscow';
  const modelDefault = args.model || process.env.TG_AI_MODEL || 'gpt-4.1';
  const nowIsoDefault = args.nowIso || new Date().toISOString();

  const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_TOKEN_LOCAL || null;
  const tasksDbId = args.tasksDbId || process.env.NOTION_TASKS_DB_ID || null;
  const notionCats = args.categoriesFromNotion ? await getAllowedCategories({ notionToken, tasksDbId }) : null;

  const limit = Number.isFinite(args.limit) ? Math.max(1, Math.trunc(args.limit)) : null;
  const selected = limit ? rows.slice(0, limit) : rows;

  const runId = makeId('evals', {
    dataset: args.dataset,
    limit: limit || null,
    model: modelDefault,
    tz: tzDefault,
  });

  const now = new Date();
  const defaultOut = path.join(repoRoot, 'data', 'evals', `report-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  const outPath = args.outPath ? path.resolve(repoRoot, args.outPath) : defaultOut;

  const report = {
    runId,
    createdAt: now.toISOString(),
    dataset: args.dataset,
    datasetAbsPath: datasetPath,
    model: modelDefault,
    tz: tzDefault,
    nowIso: nowIsoDefault,
    categoriesSource: args.categoriesFromNotion ? 'notion' : 'dataset_or_default',
    cases: [],
    summary: { total: 0, ok: 0, mismatch: 0, error: 0 },
  };

  const perCallSleepMs = Math.max(0, Math.min(10_000, Number(args.sleepMs) || 0));
  const retries = Math.max(0, Math.min(20, Number(args.retries) || 0));
  const retryBaseMs = Math.max(0, Math.min(60_000, Number(args.retryBaseMs) || 0));

  for (const row of selected) {
    const c = isPlainObject(row.obj) ? row.obj : {};
    const id = c.id ? String(c.id) : makeId('case', { lineNo: row.lineNo, userText: c.userText || '' });
    const userText = String(c.userText || '');
    const tz = c.tz ? String(c.tz) : tzDefault;
    const nowIso = c.nowIso ? String(c.nowIso) : nowIsoDefault;
    const allowedCategories = Array.isArray(c.allowedCategories)
      ? c.allowedCategories
      : Array.isArray(notionCats)
        ? notionCats
        : ['Inbox', 'Work', 'Home', 'Personal', 'Everyday'];

    const input = {
      id,
      lineNo: row.lineNo,
      userText,
      tz,
      nowIso,
      allowedCategories,
      lastShownList: Array.isArray(c.lastShownList) ? c.lastShownList : null,
      lastShownIdeasList: Array.isArray(c.lastShownIdeasList) ? c.lastShownIdeasList : null,
      lastShownSocialList: Array.isArray(c.lastShownSocialList) ? c.lastShownSocialList : null,
      memorySummary: c.memorySummary ? String(c.memorySummary) : null,
      chatSummary: c.chatSummary ? String(c.chatSummary) : null,
      chatHistory: c.chatHistory ? String(c.chatHistory) : null,
      workContext: c.workContext ? String(c.workContext) : null,
      expected: c.expected || null,
    };

    const item = {
      id,
      lineNo: row.lineNo,
      ok: false,
      status: 'error',
      reasons: [],
      diffs: [],
      expected: normalizeExpected(input.expected),
      actual: null,
      error: null,
    };

    try {
      const plan = await planWithRetry({
        retries,
        baseMs: retryBaseMs,
        sleepMs: perCallSleepMs,
        makePlanFn: async () =>
          await planAgentAction({
            apiKey,
            model: c.model ? String(c.model) : modelDefault,
            userText: input.userText,
            allowedCategories: input.allowedCategories,
            lastShownList: input.lastShownList || undefined,
            lastShownIdeasList: input.lastShownIdeasList || undefined,
            lastShownSocialList: input.lastShownSocialList || undefined,
            tz: input.tz,
            nowIso: input.nowIso,
            memorySummary: input.memorySummary || undefined,
            chatSummary: input.chatSummary || undefined,
            chatHistory: input.chatHistory || undefined,
            workContext: input.workContext || undefined,
          }),
      });

      item.actual = plan;
      const cmp = comparePlan({ expected: input.expected, actual: plan });
      item.ok = Boolean(cmp.ok);
      item.status = item.ok ? 'ok' : 'mismatch';
      item.reasons = cmp.reasons;
      item.diffs = cmp.diffs;
    } catch (e) {
      item.ok = false;
      item.status = 'error';
      item.error = { message: String(e?.message || e), name: e?.name || null };
    }

    report.cases.push(item);
    report.summary.total += 1;
    if (item.status === 'ok') report.summary.ok += 1;
    if (item.status === 'mismatch') report.summary.mismatch += 1;
    if (item.status === 'error') report.summary.error += 1;

    if (args.failFast && item.status !== 'ok') break;
  }

  const filteredCases = args.onlyMismatch ? report.cases.filter((c) => c.status !== 'ok') : report.cases;
  const outReport = { ...report, cases: filteredCases };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(outReport, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(outPath);

  process.exitCode = report.summary.mismatch || report.summary.error ? 2 : 0;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('evals fatal error', e);
  process.exitCode = 1;
});

