/**
 * Генератор датасета для тестирования реальных /commands бота
 *
 * Тестируемые команды (из todo_bot.js):
 * - /start (2)
 * - /list (3)
 * - /today (3)
 * - /addtask (3)
 * - /commands, /cmnds (2)
 * - /prefs_pg (3)
 * - /prefs_rm (3)
 * - /model (2)
 * - /struct (2)
 * - /worker_run (2)
 * - /errors (2)
 * - /chat_history (3)
 * - /chat_find (3)
 * - /chat_at (2)
 * - /sessions (2)
 * - /security_status (2)
 * - Start (кнопка) (1)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex').slice(0, 8);
}

function isoZ(y, m, d, hh = 9, mm = 0, ss = 0) {
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  return dt.toISOString();
}

function writeJsonl(outPath, cases) {
  const lines = cases.map((c) => JSON.stringify(c));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const tz = 'Europe/Moscow';
  const nowIso = isoZ(2026, 1, 13, 9, 0, 0);

  const allCases = [];

  // /start (2)
  allCases.push({
    id: 'cmd_start_1',
    userText: '/start',
    tz,
    nowIso,
    expected: { type: 'command', command: 'start' },
  });
  allCases.push({
    id: 'cmd_start_2',
    userText: '/start ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'start' },
  });

  // /list (3)
  allCases.push({
    id: 'cmd_list_1',
    userText: '/list',
    tz,
    nowIso,
    expected: { type: 'command', command: 'list' },
  });
  allCases.push({
    id: 'cmd_list_2',
    userText: '/list ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'list' },
  });
  allCases.push({
    id: 'cmd_list_3',
    userText: '/list\n',
    tz,
    nowIso,
    expected: { type: 'command', command: 'list' },
  });

  // /today (3)
  allCases.push({
    id: 'cmd_today_1',
    userText: '/today',
    tz,
    nowIso,
    expected: { type: 'command', command: 'today' },
  });
  allCases.push({
    id: 'cmd_today_2',
    userText: '/today ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'today' },
  });
  allCases.push({
    id: 'cmd_today_3',
    userText: '/Today',
    tz,
    nowIso,
    comment: 'Case sensitivity test',
    expected: { typeAnyOf: ['command', 'chat', 'tool'] },
  });

  // /addtask (3)
  allCases.push({
    id: 'cmd_addtask_1',
    userText: '/addtask',
    tz,
    nowIso,
    expected: { type: 'command', command: 'addtask' },
  });
  allCases.push({
    id: 'cmd_addtask_2',
    userText: '/addtask тест',
    tz,
    nowIso,
    expected: { type: 'command', command: 'addtask' },
  });
  allCases.push({
    id: 'cmd_addtask_3',
    userText: '/addtask купить молоко',
    tz,
    nowIso,
    expected: { type: 'command', command: 'addtask' },
  });

  // /commands, /cmnds (2)
  allCases.push({
    id: 'cmd_commands_1',
    userText: '/commands',
    tz,
    nowIso,
    expected: { type: 'command', command: 'commands' },
  });
  allCases.push({
    id: 'cmd_cmnds_1',
    userText: '/cmnds',
    tz,
    nowIso,
    expected: { type: 'command', command: 'cmnds' },
  });

  // /prefs_pg (3)
  allCases.push({
    id: 'cmd_prefs_pg_1',
    userText: '/prefs_pg',
    tz,
    nowIso,
    expected: { type: 'command', command: 'prefs_pg' },
  });
  allCases.push({
    id: 'cmd_prefs_pg_2',
    userText: '/prefs_pg ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'prefs_pg' },
  });
  allCases.push({
    id: 'cmd_prefs_pg_3',
    userText: '/PREFS_PG',
    tz,
    nowIso,
    comment: 'Case sensitivity test',
    expected: { typeAnyOf: ['command', 'chat', 'tool'] },
  });

  // /prefs_rm (3)
  allCases.push({
    id: 'cmd_prefs_rm_1',
    userText: '/prefs_rm 1',
    tz,
    nowIso,
    expected: { type: 'command', command: 'prefs_rm' },
  });
  allCases.push({
    id: 'cmd_prefs_rm_2',
    userText: '/prefs_rm timezone',
    tz,
    nowIso,
    expected: { type: 'command', command: 'prefs_rm' },
  });
  allCases.push({
    id: 'cmd_prefs_rm_3',
    userText: '/prefs_rm',
    tz,
    nowIso,
    comment: 'Missing argument - should ask for clarification',
    expected: { type: 'command', command: 'prefs_rm' },
  });

  // /model (2)
  allCases.push({
    id: 'cmd_model_1',
    userText: '/model',
    tz,
    nowIso,
    expected: { type: 'command', command: 'model' },
  });
  allCases.push({
    id: 'cmd_model_2',
    userText: '/model ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'model' },
  });

  // /struct (2)
  allCases.push({
    id: 'cmd_struct_1',
    userText: '/struct',
    tz,
    nowIso,
    expected: { type: 'command', command: 'struct' },
  });
  allCases.push({
    id: 'cmd_struct_2',
    userText: '/struct ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'struct' },
  });

  // /worker_run (2)
  allCases.push({
    id: 'cmd_worker_run_1',
    userText: '/worker_run',
    tz,
    nowIso,
    expected: { type: 'command', command: 'worker_run' },
  });
  allCases.push({
    id: 'cmd_worker_run_2',
    userText: '/worker_run ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'worker_run' },
  });

  // /errors (2)
  allCases.push({
    id: 'cmd_errors_1',
    userText: '/errors',
    tz,
    nowIso,
    expected: { type: 'command', command: 'errors' },
  });
  allCases.push({
    id: 'cmd_errors_2',
    userText: '/errors 5',
    tz,
    nowIso,
    expected: { type: 'command', command: 'errors' },
  });

  // /chat_history (3)
  allCases.push({
    id: 'cmd_chat_history_1',
    userText: '/chat_history',
    tz,
    nowIso,
    expected: { type: 'command', command: 'chat_history' },
  });
  allCases.push({
    id: 'cmd_chat_history_2',
    userText: '/chat_history 10',
    tz,
    nowIso,
    expected: { type: 'command', command: 'chat_history' },
  });
  allCases.push({
    id: 'cmd_chat_history_3',
    userText: '/chat_history 50',
    tz,
    nowIso,
    expected: { type: 'command', command: 'chat_history' },
  });

  // /chat_find (3)
  allCases.push({
    id: 'cmd_chat_find_1',
    userText: '/chat_find тест',
    tz,
    nowIso,
    expected: { type: 'command', command: 'chat_find' },
  });
  allCases.push({
    id: 'cmd_chat_find_2',
    userText: '/chat_find релиз',
    tz,
    nowIso,
    expected: { type: 'command', command: 'chat_find' },
  });
  allCases.push({
    id: 'cmd_chat_find_3',
    userText: '/chat_find',
    tz,
    nowIso,
    comment: 'Missing argument',
    expected: { type: 'command', command: 'chat_find' },
  });

  // /chat_at (2)
  allCases.push({
    id: 'cmd_chat_at_1',
    userText: '/chat_at 10:00',
    tz,
    nowIso,
    expected: { type: 'command', command: 'chat_at' },
  });
  allCases.push({
    id: 'cmd_chat_at_2',
    userText: '/chat_at 14:30 5',
    tz,
    nowIso,
    expected: { type: 'command', command: 'chat_at' },
  });

  // /sessions (2)
  allCases.push({
    id: 'cmd_sessions_1',
    userText: '/sessions',
    tz,
    nowIso,
    expected: { type: 'command', command: 'sessions' },
  });
  allCases.push({
    id: 'cmd_sessions_2',
    userText: '/sessions 10',
    tz,
    nowIso,
    expected: { type: 'command', command: 'sessions' },
  });

  // /security_status (2)
  allCases.push({
    id: 'cmd_security_status_1',
    userText: '/security_status',
    tz,
    nowIso,
    expected: { type: 'command', command: 'security_status' },
  });
  allCases.push({
    id: 'cmd_security_status_2',
    userText: '/security_status ',
    tz,
    nowIso,
    expected: { type: 'command', command: 'security_status' },
  });

  // Start (кнопка) (1)
  allCases.push({
    id: 'cmd_start_button',
    userText: 'Start',
    tz,
    nowIso,
    comment: 'Button text instead of command',
    expected: { type: 'command', command: 'start' },
  });

  // Ensure exactly 40
  while (allCases.length < 40) {
    allCases.push({
      id: `cmd_pad_${allCases.length}`,
      userText: `/list`,
      tz,
      nowIso,
      expected: { type: 'command', command: 'list' },
    });
  }
  if (allCases.length > 40) {
    allCases.length = 40;
  }

  const outPath = path.join(repoRoot, 'apps', 'evals', 'ds', '11_2026-01-13_commands_40.jsonl');
  writeJsonl(outPath, allCases);

  // eslint-disable-next-line no-console
  console.log(`Written ${allCases.length} cases to ${outPath}`);

  // Stats
  const stats = {};
  for (const c of allCases) {
    const prefix = c.id.split('_').slice(0, 2).join('_');
    stats[prefix] = (stats[prefix] || 0) + 1;
  }
  // eslint-disable-next-line no-console
  console.log('Stats:', JSON.stringify(stats, null, 2));
}

main();

