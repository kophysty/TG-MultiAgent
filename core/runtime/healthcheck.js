const { hydrateProcessEnv } = require('./env');
const { sanitizeErrorForLog } = require('./log_sanitize');
const { runHealthcheck } = require('./healthcheck_lib');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const json = args.has('--json');
  const wantTelegram = args.has('--telegram');
  const wantNotion = args.has('--notion') || (!args.has('--postgres') && !args.has('--telegram'));
  const wantPostgres = args.has('--postgres') || (!args.has('--notion') && !args.has('--telegram'));
  return { wantTelegram, wantNotion, wantPostgres, json };
}

function printSection(title, res) {
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
  for (const it of res.items || []) {
    const status = it.ok ? 'ok' : 'fail';
    // eslint-disable-next-line no-console
    console.log(`- ${status} ${it.name}${it.info ? `: ${typeof it.info === 'string' ? it.info : JSON.stringify(it.info)}` : ''}`);
  }
}

async function main() {
  hydrateProcessEnv();
  const { wantTelegram, wantNotion, wantPostgres, json } = parseArgs(process.argv);

  const report = await runHealthcheck({ wantPostgres, wantNotion, wantTelegram });
  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report));
  }

  // eslint-disable-next-line no-console
  if (!json) {
    if (wantPostgres && report.sections.postgres) printSection('Postgres', report.sections.postgres);
    if (wantNotion && report.sections.notion) printSection('Notion', report.sections.notion);
    if (wantTelegram && report.sections.telegram) printSection('Telegram', report.sections.telegram);
    console.log(`\nResult: ${report.ok ? 'OK' : 'FAIL'}`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Healthcheck fatal error:', sanitizeErrorForLog(e));
  process.exitCode = 1;
});



