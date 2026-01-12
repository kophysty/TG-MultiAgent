const fs = require('fs');
const path = require('path');

const {
  extractExplicitMemoryNoteText,
  isExplicitMemoryCommandWithoutPayload,
  isLikelyPreferenceText,
} = require('../../../core/ai/preference_extractor');

function parseArgs(argv) {
  const out = { dataset: null, limit: null, outPath: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset' && argv[i + 1]) out.dataset = String(argv[++i]);
    if (a === '--limit' && argv[i + 1]) out.limit = Number(argv[++i]);
    if (a === '--out' && argv[i + 1]) out.outPath = String(argv[++i]);
    if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  return [
    'Usage:',
    '  node apps/evals/src/memory_eval.js --dataset <path.jsonl> [options]',
    '',
    'Options:',
    '  --dataset <path>   Path to jsonl dataset (required)',
    '  --limit <N>        Run only first N cases',
    '  --out <path>       Write report json to this path (default: data/evals/memory-report-<ts>.json)',
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

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function classify(userText) {
  const text = String(userText || '');
  const noteText = extractExplicitMemoryNoteText(text);
  if (noteText) return { route: 'memory_note', noteText };
  if (isExplicitMemoryCommandWithoutPayload(text)) return { route: 'clarify', noteText: null };
  if (isLikelyPreferenceText(text)) return { route: 'extractor', noteText: null };
  return { route: 'none', noteText: null };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.dataset) {
    console.log(usage());
    process.exit(args.help ? 0 : 2);
  }

  const datasetPath = path.isAbsolute(args.dataset) ? args.dataset : path.join(process.cwd(), args.dataset);
  const rows = readJsonl(datasetPath);
  const limit = Number.isFinite(args.limit) ? Math.max(1, Math.trunc(args.limit)) : null;
  const slice = limit ? rows.slice(0, limit) : rows;

  const results = [];
  let ok = 0;
  let fail = 0;

  for (const { lineNo, obj } of slice) {
    const id = obj.id || `line_${lineNo}`;
    const input = String(obj.input || '');
    const expected = obj.expect || {};
    const actual = classify(input);

    const expRoute = expected.route || null;
    const expNoteText = expected.noteText === undefined ? undefined : expected.noteText;

    let pass = true;
    const diffs = [];

    if (expRoute && actual.route !== expRoute) {
      pass = false;
      diffs.push({ field: 'route', expected: expRoute, actual: actual.route });
    }
    if (expNoteText !== undefined) {
      if ((expNoteText || null) !== (actual.noteText || null)) {
        pass = false;
        diffs.push({ field: 'noteText', expected: expNoteText || null, actual: actual.noteText || null });
      }
    }

    if (pass) ok += 1;
    else fail += 1;

    results.push({ id, lineNo, input, expected: { route: expRoute, noteText: expNoteText }, actual, pass, diffs });
  }

  const report = {
    meta: {
      dataset: args.dataset,
      datasetResolved: datasetPath,
      count: results.length,
      ok,
      fail,
      ts: new Date().toISOString(),
    },
    results,
  };

  const outPath =
    args.outPath ||
    path.join(process.cwd(), 'data', 'evals', `memory-report-${nowStamp()}.json`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Memory eval done: total=${results.length} ok=${ok} fail=${fail}`);
  console.log(`Report: ${outPath}`);
  if (fail) process.exit(1);
}

main();

