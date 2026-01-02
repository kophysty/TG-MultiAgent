const { spawn } = require('child_process');
const path = require('path');

const { hydrateProcessEnv } = require('./env');

function pickNpmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function parseArgs(argv) {
  const out = { mode: null, debug: null, ai: null };
  for (const a of argv.slice(2)) {
    if (a === '--prod') out.mode = 'prod';
    if (a === '--tests') out.mode = 'tests';
    if (a === '--debug') out.debug = '1';
    if (a === '--no-debug') out.debug = '0';
    if (a === '--ai') out.ai = '1';
    if (a === '--no-ai') out.ai = '0';
  }
  return out;
}

function spawnApp({ name, cwd, extraEnv }) {
  const npmCmd = pickNpmCmd();
  const child = spawn(npmCmd, ['start'], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...(extraEnv || {}) },
  });
  child.on('exit', (code, signal) => {
    // eslint-disable-next-line no-console
    console.log(`[dev_runner] ${name} exited code=${code} signal=${signal || '-'}`);
  });
  return child;
}

async function main() {
  hydrateProcessEnv();
  const args = parseArgs(process.argv);

  const repoRoot = path.resolve(__dirname, '..', '..');
  const todoCwd = path.join(repoRoot, 'apps', 'todo_bot');
  const workerCwd = path.join(repoRoot, 'apps', 'reminders_worker');

  const mode = args.mode || String(process.env.TG_BOT_MODE || 'tests').trim().toLowerCase() || 'tests';
  const tz = process.env.TG_TZ || 'Europe/Moscow';
  const debug = args.debug !== null ? args.debug : String(process.env.TG_DEBUG || '').trim() || '1';
  const ai = args.ai !== null ? args.ai : String(process.env.TG_AI || '').trim() || '1';

  // eslint-disable-next-line no-console
  console.log(`[dev_runner] starting bot+worker mode=${mode} tz=${tz} debug=${debug} ai=${ai}`);

  const bot = spawnApp({
    name: 'todo_bot',
    cwd: todoCwd,
    extraEnv: {
      TG_BOT_MODE: mode,
      TG_TZ: tz,
      TG_DEBUG: debug,
      TG_AI: ai,
    },
  });

  const worker = spawnApp({
    name: 'reminders_worker',
    cwd: workerCwd,
    extraEnv: {
      TG_BOT_MODE: mode,
      TG_TZ: tz,
    },
  });

  const killAll = () => {
    try {
      bot.kill('SIGTERM');
    } catch {}
    try {
      worker.kill('SIGTERM');
    } catch {}
  };

  process.on('SIGINT', () => {
    // eslint-disable-next-line no-console
    console.log('[dev_runner] SIGINT, stopping...');
    killAll();
  });
  process.on('SIGTERM', () => {
    // eslint-disable-next-line no-console
    console.log('[dev_runner] SIGTERM, stopping...');
    killAll();
  });

  // If one process exits, stop the other to avoid orphaned runs.
  bot.on('exit', () => killAll());
  worker.on('exit', () => killAll());
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[dev_runner] fatal error', e);
  process.exitCode = 1;
});


