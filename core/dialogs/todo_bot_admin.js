const fs = require('fs');
const path = require('path');

const { runHealthcheck } = require('../runtime/healthcheck_lib');

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function listExecutionHistoryFiles() {
  const root = getRepoRoot();
  const dir = path.join(root, 'execution_history');
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_.+\.md$/.test(name))
    .sort()
    .reverse();
  return files;
}

function readExecutionHistoryFileSafe(fileName) {
  const root = getRepoRoot();
  const dir = path.join(root, 'execution_history');
  const safeName = String(fileName || '').replace(/[\\/]/g, '').trim();
  if (!/^\d{4}-\d{2}-\d{2}_.+\.md$/.test(safeName)) return null;
  const p = path.join(dir, safeName);
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function extractSprintDigest(md) {
  const text = String(md || '');
  const lines = text.split('\n');

  const firstH1 = lines.find((l) => /^#\s+/.test(l)) || '';
  const title = firstH1 ? firstH1.replace(/^#\s+/, '').trim() : null;

  const sections = {};
  let cur = null;
  for (const raw of lines) {
    const line = String(raw || '');
    const m = line.match(/^##\s+(.+)\s*$/);
    if (m) {
      cur = m[1].trim();
      if (!sections[cur]) sections[cur] = [];
      continue;
    }
    if (!cur) continue;
    sections[cur].push(line);
  }

  const pickSection = (names) => {
    for (const n of names) {
      const body = sections[n];
      if (!body) continue;
      const cleaned = body.join('\n').trim();
      if (cleaned) return cleaned;
    }
    return null;
  };

  const goal = pickSection(['Цель', 'Goal']);
  const changes = pickSection(['Изменения', 'Что сделано', 'Changes implemented', 'Summary', 'Changes implemented']);
  const files = pickSection(['Файлы', 'Files', 'Files changed (high signal)']);
  const validate = pickSection(['Как проверить', 'Validation']);

  const parts = [];
  if (title) parts.push(`## ${title}`);
  if (goal) parts.push(['Цель:', goal].join('\n'));
  if (changes) parts.push(['Что сделано:', changes].join('\n'));
  if (files) parts.push(['Файлы:', files].join('\n'));
  if (validate) parts.push(['Как проверить:', validate].join('\n'));

  const out = parts.join('\n\n').trim();
  return out || null;
}

function parseHmToken(s) {
  const raw = String(s || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = m[2] !== undefined ? Number(m[2]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function pad2(n) {
  return String(Number(n) || 0).padStart(2, '0');
}

function yyyyMmDdUtc(date = new Date()) {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function safeSendAndExitProcess({ bot, chatId, text }) {
  try {
    await bot.sendMessage(chatId, String(text || 'Перезапуск...'));
  } catch {
    // ignore
  }
  setTimeout(() => process.exit(0), 800);
}

function formatHealthSection(res) {
  const items = Array.isArray(res?.items) ? res.items : [];
  const ok = Boolean(res?.ok);
  const lines = [];
  lines.push(ok ? 'ok' : 'fail');
  for (const it of items.slice(0, 30)) {
    const status = it.ok ? 'ok' : 'fail';
    const info = it.info ? `: ${typeof it.info === 'string' ? it.info : JSON.stringify(it.info)}` : '';
    lines.push(`- ${status} ${it.name}${info}`);
  }
  return lines.join('\n');
}

function registerAdminCommands({
  bot,
  chatSecurity,
  pgPool,
  preferencesRepo,
  chatMemoryRepo,
  remindersRepo,
  tz,
  sendLongMessage,
  splitTelegramText,
  truncate,
  oneLinePreview,
  formatTsInTzShort,
  yyyyMmDdInTz,
  formatChatLine,
  callChatCompletions,
  isAiEnabled,
  isChatMemoryEnabledForChat,
  md5Hex,
  makeId,
  memoryCacheByChatId,
  lastShownHistoryByChatId,
  lastShownPrefsListByChatId,
}) {
  if (!bot) throw new Error('bot is required');
  if (!chatSecurity) throw new Error('chatSecurity is required');

  async function loadChatMessagesByLocalRange({ chatId, ymd, fromHm, toHm, maxRows = 300 }) {
    if (!pgPool || !chatMemoryRepo) return [];
    const date = String(ymd || '').trim();
    if (!date) return [];
    const a = parseHmToken(fromHm);
    const b = parseHmToken(toHm);
    if (!a || !b) return [];

    const startLocal = `${date} ${pad2(a.hh)}:${pad2(a.mm)}:00`;
    let endDate = date;
    const endLocalSameDay = `${date} ${pad2(b.hh)}:${pad2(b.mm)}:00`;
    if (endLocalSameDay <= startLocal) {
      // cross midnight
      const dt = new Date(`${date}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      endDate = yyyyMmDdUtc(dt);
    }
    const endLocal = `${endDate} ${pad2(b.hh)}:${pad2(b.mm)}:00`;

    const lim = Math.max(10, Math.min(600, Math.trunc(Number(maxRows) || 300)));
    const r = await pgPool.query(
      `select id, role, text, tg_message_id, created_at
       from chat_messages
       where chat_id = $1
         and (created_at at time zone $2) >= $3::timestamp
         and (created_at at time zone $2) < $4::timestamp
       order by id asc
       limit $5`,
      [Number(chatId), tz, startLocal, endLocal, lim]
    );
    return r.rows || [];
  }

  async function sendChatAtTime({ chatId, ymd, hm, windowMin = 1 }) {
    const a = parseHmToken(hm);
    if (!a) {
      bot.sendMessage(chatId, 'Неверный формат времени. Пример: 04:11');
      return true;
    }
    const date = String(ymd || '').trim();
    if (!date) return false;
    const w = Math.max(0, Math.min(15, Math.trunc(Number(windowMin) || 1)));
    const target = a.hh * 60 + a.mm;
    const startMm = Math.max(0, target - w);
    const endMm = Math.min(24 * 60, target + w + 1);
    const start = { hh: Math.floor(startMm / 60), mm: startMm % 60 };
    const end = { hh: Math.floor(endMm / 60), mm: endMm % 60 };
    const rows = await loadChatMessagesByLocalRange({
      chatId,
      ymd: date,
      fromHm: `${pad2(start.hh)}:${pad2(start.mm)}`,
      toHm: `${pad2(end.hh)}:${pad2(end.mm)}`,
      maxRows: 250,
    });

    if (!rows.length) {
      bot.sendMessage(chatId, `Ничего не нашел около ${date} ${pad2(a.hh)}:${pad2(a.mm)} (±${w}м).`);
      return true;
    }

    const lines = [`Сообщения около ${date} ${pad2(a.hh)}:${pad2(a.mm)} (±${w}м):`, ''];
    for (const r of rows) {
      const ts = formatTsInTzShort(r?.created_at || null, tz);
      const role = String(r?.role || 'unknown');
      const mid = r?.tg_message_id ? `#${r.tg_message_id}` : '-';
      const text = oneLinePreview(String(r?.text || ''), 420);
      if (!text) continue;
      lines.push(`${ts} ${role} ${mid}: ${text}`);
    }
    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
    return true;
  }

  async function sendChatSummaryRange({ chatId, ymd, fromHm, toHm, callChatCompletions }) {
    const date = String(ymd || '').trim();
    if (!date) return false;

    const rows = await loadChatMessagesByLocalRange({ chatId, ymd: date, fromHm, toHm, maxRows: 400 });
    if (!rows.length) {
      bot.sendMessage(chatId, `Нечего суммаризировать: сообщений нет за ${date} ${fromHm}-${toHm}.`);
      return true;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      bot.sendMessage(chatId, 'OPENAI_API_KEY не найден. Не могу сделать саммари. Могу показать сообщения: /chat_history 80');
      return true;
    }

    const model = process.env.TG_CHAT_SUMMARY_MODEL || 'gpt-4.1-mini';
    const transcriptLines = [];
    for (const r of rows.slice(0, 350)) {
      const ts = formatTsInTzShort(r?.created_at || null, tz);
      const role = String(r?.role || 'unknown');
      const text = oneLinePreview(String(r?.text || ''), 500);
      if (!text) continue;
      transcriptLines.push(`${ts} ${role}: ${text}`);
    }

    const messages = [
      {
        role: 'system',
        content: [
          'Ты помощник, который делает краткую сводку переписки в Telegram.',
          'Используй ТОЛЬКО предоставленные сообщения. Не выдумывай факты.',
          'Верни JSON строго в формате:',
          '{"summary":"...","highlights":["..."],"open_questions":["..."],"action_items":["..."]}',
          'Пиши по-русски. Коротко, но конкретно.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [`Сделай сводку за период: ${date} ${fromHm}-${toHm} (${tz}).`, `Сообщений: ${rows.length}.`, '', transcriptLines.join('\n')].join(
          '\n'
        ),
      },
    ];

    let parsed = null;
    try {
      const raw = await callChatCompletions({ apiKey, model, messages, temperature: 0.2 });
      parsed = JSON.parse(raw);
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось сделать саммари (LLM). Ошибка: ${String(e?.message || e)}`);
      return true;
    }

    const summary = parsed && parsed.summary ? String(parsed.summary).trim() : '';
    const highlights = Array.isArray(parsed?.highlights) ? parsed.highlights.map((x) => String(x)).filter((x) => x.trim()) : [];
    const openQ = Array.isArray(parsed?.open_questions) ? parsed.open_questions.map((x) => String(x)).filter((x) => x.trim()) : [];
    const actions = Array.isArray(parsed?.action_items) ? parsed.action_items.map((x) => String(x)).filter((x) => x.trim()) : [];

    const out = [];
    out.push(`Сводка: ${date} ${fromHm}-${toHm} (${tz})`);
    out.push(`- сообщений: ${rows.length}`);
    out.push('');
    if (summary) out.push(summary);
    if (highlights.length) {
      out.push('');
      out.push('Ключевое:');
      for (const h of highlights.slice(0, 10)) out.push(`- ${h}`);
    }
    if (actions.length) {
      out.push('');
      out.push('Action items:');
      for (const a of actions.slice(0, 10)) out.push(`- ${a}`);
    }
    if (openQ.length) {
      out.push('');
      out.push('Открытые вопросы:');
      for (const q of openQ.slice(0, 10)) out.push(`- ${q}`);
    }
    await sendLongMessage({ bot, chatId, text: out.join('\n') });
    return true;
  }

  async function maybeHandleAdminChatMemoryNaturalLanguage({ chatId, text, callChatCompletions }) {
    if (!chatSecurity.isAdminChat(chatId)) return false;
    if (!pgPool || !chatMemoryRepo) return false;
    if (!(await isChatMemoryEnabledForChat(chatId))) return false;

    const t = String(text || '').trim();
    if (!t) return false;
    const low = t.toLowerCase();

    const date = yyyyMmDdInTz({ tz });

    const at = low.match(/\b(?:в|во)\s*(\d{1,2}[:.]\d{2})\b/);
    if (/(сообщен)/.test(low) && at && at[1]) {
      return await sendChatAtTime({ chatId, ymd: date, hm: at[1], windowMin: 1 });
    }

    const range = low.match(/с\s*(\d{1,2}(?:[:.]\d{2})?)\s*до\s*(\d{1,2}(?:[:.]\d{2})?)/);
    if (/(саммари|сводк|резюм|summary)/.test(low) && range && range[1] && range[2]) {
      const a = parseHmToken(range[1]);
      const b = parseHmToken(range[2]);
      if (!a || !b) return false;
      return await sendChatSummaryRange({
        chatId,
        ymd: date,
        fromHm: `${pad2(a.hh)}:${pad2(a.mm)}`,
        toHm: `${pad2(b.hh)}:${pad2(b.mm)}`,
        callChatCompletions,
      });
    }

    // "рандомные/случайные сообщения"
    if (/(рандом|случайн)/.test(low) && /(сообщен)/.test(low)) {
      let rows = [];
      try {
        rows = await chatMemoryRepo.listLastN({ chatId, limit: 200 });
      } catch {
        rows = [];
      }
      if (!rows.length) {
        bot.sendMessage(chatId, '(chat memory пустая)');
        return true;
      }
      const pickN = Math.min(12, Math.max(3, Math.trunc(rows.length >= 12 ? 10 : rows.length)));
      const out = [];
      const used = new Set();
      while (out.length < pickN && used.size < rows.length) {
        const idx = Math.floor(Math.random() * rows.length);
        if (used.has(idx)) continue;
        used.add(idx);
        out.push(rows[idx]);
      }
      const lines = [`Случайные сообщения (из последних ${rows.length}):`, ''];
      for (const r of out) {
        const ts = formatTsInTzShort(r?.created_at || null, tz);
        const role = String(r?.role || 'unknown');
        const mid = r?.tg_message_id ? `#${r.tg_message_id}` : '-';
        const text0 = oneLinePreview(String(r?.text || ''), 400);
        if (!text0) continue;
        lines.push(`${ts} ${role} ${mid}: ${text0}`);
      }
      await sendLongMessage({ bot, chatId, text: lines.join('\n') });
      return true;
    }

    // "покажи сообщения" без времени: показать последние 30.
    if (/(покажи|выведи).*(сообщен)/.test(low)) {
      let rows = [];
      try {
        rows = await chatMemoryRepo.listLastN({ chatId, limit: 30 });
      } catch {
        rows = [];
      }
      if (!rows.length) {
        bot.sendMessage(chatId, '(chat memory пустая)');
        return true;
      }
      const lines = [`Chat history (последние ${rows.length}):`, ''];
      for (const r of rows) {
        const ts = formatTsInTzShort(r?.created_at || null, tz);
        const role = String(r?.role || 'unknown');
        const mid = r?.tg_message_id ? `#${r.tg_message_id}` : '-';
        const text0 = oneLinePreview(String(r?.text || ''), 400);
        if (!text0) continue;
        lines.push(`${ts} ${role} ${mid}: ${text0}`);
      }
      await sendLongMessage({ bot, chatId, text: lines.join('\n') });
      return true;
    }

    return false;
  }

  bot.onText(/^\/(?:healthcheck|hc)\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const report = await runHealthcheck({ wantPostgres: true, wantNotion: true, wantTelegram: false });
    const lines = ['Healthcheck:', `- ok: ${report.ok ? 'true' : 'false'}`, `- ts: ${report.ts}`, ''];
    if (report.sections.postgres) {
      lines.push('Postgres:');
      lines.push(formatHealthSection(report.sections.postgres));
      lines.push('');
    }
    if (report.sections.notion) {
      lines.push('Notion:');
      lines.push(formatHealthSection(report.sections.notion));
    }
    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

  bot.onText(/^\/healthcheck_json\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const report = await runHealthcheck({ wantPostgres: true, wantNotion: true, wantTelegram: false });
    await sendLongMessage({ bot, chatId, text: JSON.stringify(report) });
  });

  bot.onText(/^\/restart_polling\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    bot.sendMessage(chatId, 'Ок. Перезапускаю polling в этом процессе.');
    try {
      await bot.stopPolling();
    } catch {
      // ignore
    }
    setTimeout(() => {
      bot.startPolling().catch(() => {});
    }, 800);
  });

  bot.onText(/^\/restart_process(?:\s+(.+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const arg = match && match[1] ? String(match[1]).trim().toLowerCase() : '';
    if (arg !== 'confirm') {
      bot.sendMessage(chatId, 'Подтверди перезапуск процесса: /restart_process confirm');
      return;
    }
    await safeSendAndExitProcess({
      bot,
      chatId,
      text: 'Ок. Завершаю процесс. Если бот запущен в Docker с restart policy, он поднимется снова.',
    });
  });

  bot.onText(/^\/(?:commands|cmnds)\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }

    const lines = [
      'Админские команды:',
      '',
      '- /cmnds (алиас: /commands) - показать этот список',
      '- /healthcheck (алиас: /hc) - проверить Postgres и Notion',
      '- /healthcheck_json - healthcheck в JSON',
      '- /restart_polling - перезапуск polling в этом процессе',
      '- /restart_process confirm - завершить процесс (нужен supervisor, например Docker restart policy)',
      '- /model - показать активные модели (AI, prefs extractor, STT)',
      '- /prefs_pg - показать preferences строго из Postgres (по текущему чату)',
      '- /prefs_rm <номер|key> - выключить preference (active=false) и отправить это в Notion',
      '- /worker_run - попросить reminders worker сделать синхронизацию memory (Notion <-> Postgres) сейчас (без отправки напоминаний)',
      '- /errors [hours] - последние ошибки (event_log) по текущему чату, по умолчанию 24ч',
      '- /chat_history [N] - показать последние N сообщений из chat memory (по умолчанию 30)',
      '- /chat_find <text> - поиск по chat memory (последние ~200 сообщений)',
      '- /chat_at HH:MM [windowMin] - показать сообщения около времени (пример: /chat_at 04:11)',
      '- /chat_summary HH:MM HH:MM - саммари сообщений за диапазон (пример: /chat_summary 02:00 03:00)',
      '- /history_list N - список файлов в execution_history (пример: /history_list 20)',
      '- /history_show N - показать конспект sprint файла по номеру из /history_list (пример: /history_show 3)',
      '- /history_show 2026-01-05_test_tasks_mode_predeploy.md - показать конспект по имени файла',
      '- /history_summary N - summary за последние N дней (пример: /history_summary 3)',
      '- /logs [hours] - экспорт логов (event_log + chat_messages) за последние N часов (по умолчанию 24), отправит JSON файлом',
      '',
      'Security:',
      '- /sessions [N]',
      '- /security_status',
      '- /allow <chatId>',
      '- /allow_here',
      '- /unallow <chatId>',
      '- /unallow_here',
      '- /revoke <chatId> [reason]',
      '- /revoke_here [reason]',
      '- /unrevoke <chatId>',
    ];

    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

  bot.onText(/^\/model\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const ai = process.env.TG_AI_MODEL || process.env.AI_MODEL || 'gpt-4.1';
    const pref = process.env.TG_PREF_EXTRACTOR_MODEL || process.env.TG_AI_MODEL || process.env.AI_MODEL || 'gpt-4.1-mini';
    const stt = process.env.TG_STT_MODEL || 'whisper-1';
    const aiEnabled = typeof isAiEnabled === 'function' ? isAiEnabled() : true;
    const hasApiKey = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
    bot.sendMessage(
      chatId,
      [
        'Активные модели:',
        `- AI: ${ai}`,
        `- Preferences extractor: ${pref}`,
        `- STT: ${stt}`,
        '',
        'AI режим:',
        `- TG_AI: ${aiEnabled ? 'on' : 'off'}`,
        `- OPENAI_API_KEY: ${hasApiKey ? 'set' : 'missing'}`,
        '',
        'Настройка по умолчанию:',
        '- TG_AI_MODEL=gpt-5.1 (или AI_MODEL как алиас)',
      ].join('\n')
    );
  });

  bot.onText(/^\/prefs_pg\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!preferencesRepo) {
      bot.sendMessage(chatId, 'Postgres не настроен. Добавь POSTGRES_URL.');
      return;
    }
    let rows = [];
    try {
      rows = await preferencesRepo.listPreferencesForChat({ chatId, activeOnly: true });
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось прочитать preferences из Postgres. Ошибка: ${String(e?.message || e)}`);
      return;
    }
    if (!rows.length) {
      bot.sendMessage(chatId, '(preferences пусто)');
      return;
    }
    const shown = [];
    const lines = ['Preferences (Postgres):', ''];
    for (const r of rows.slice(0, 30)) {
      const key = String(r.pref_key || '').trim();
      const val = String(r.value_human || '').trim();
      const cat = r.category === null || r.category === undefined ? null : String(r.category || '').trim() || null;
      const src = String(r.source || '').trim() || '-';
      const upd = r.updated_at ? String(r.updated_at).slice(0, 19).replace('T', ' ') : '';
      const label = cat === 'memory_note' ? 'memory' : key;
      const idx = shown.length + 1;
      shown.push({ index: idx, scope: String(r.scope || 'global').trim() || 'global', key, category: cat });
      const keyHint = cat === 'memory_note' ? `key=${key}` : '';
      lines.push(
        `${idx}) ${label}: ${val || '(empty)'} (${[keyHint, `source=${src}`, upd ? `updated=${upd}` : null].filter(Boolean).join(', ')})`
      );
    }
    lastShownPrefsListByChatId.set(chatId, shown);
    lines.push('');
    lines.push('Удаление: /prefs_rm <номер|key> (пример: /prefs_rm 2)');
    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

  bot.onText(/^\/prefs_rm(?:\s+(.+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!preferencesRepo) {
      bot.sendMessage(chatId, 'Postgres не настроен. Добавь POSTGRES_URL.');
      return;
    }

    const rawArg = match && match[1] ? String(match[1]).trim() : '';
    if (!rawArg) {
      bot.sendMessage(chatId, 'Укажи что удалить: /prefs_rm <номер|key>. Сначала посмотри /prefs_pg.');
      return;
    }

    let scope = 'global';
    let key = '';
    const asNum = Number(rawArg);
    if (Number.isFinite(asNum) && String(asNum) === String(Math.trunc(asNum)) && asNum >= 1 && asNum <= 200) {
      const list = lastShownPrefsListByChatId.get(chatId) || [];
      const it = list.find((x) => Number(x.index) === Math.trunc(asNum)) || null;
      if (!it) {
        bot.sendMessage(chatId, 'Не нашел такой номер. Обнови список через /prefs_pg и попробуй снова.');
        return;
      }
      scope = String(it.scope || 'global').trim() || 'global';
      key = String(it.key || '').trim();
    } else {
      key = String(rawArg).trim();
      scope = 'global';
    }

    if (!key) {
      bot.sendMessage(chatId, 'Не получилось определить key. Обнови /prefs_pg и попробуй снова.');
      return;
    }

    try {
      await preferencesRepo.setPreferenceActiveWithSource({ chatId, scope, key, active: false, source: 'postgres' });
      if (memoryCacheByChatId) memoryCacheByChatId.delete(chatId);
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось обновить preference в Postgres. Ошибка: ${String(e?.message || e)}`);
      return;
    }

    try {
      const row = await preferencesRepo.getPreference({ chatId, scope, key, activeOnly: false });
      const categoryRaw = row?.category === null || row?.category === undefined ? null : String(row.category || '').trim() || null;
      const category = categoryRaw === 'memory_note' || categoryRaw === 'settings' ? null : categoryRaw;
      const externalId = preferencesRepo.makeExternalId({ chatId, scope, key });
      const valueHuman = row?.value_human === null || row?.value_human === undefined ? null : String(row.value_human || '').trim() || null;
      const valueJsonStr = JSON.stringify(row?.value_json || {});
      const payload = {
        externalId,
        chatId,
        scope,
        category,
        key,
        active: false,
        valueHuman,
        valueJson: valueJsonStr,
        syncHash: md5Hex(JSON.stringify({ externalId, chatId, scope, key, active: false, valueHuman, valueJsonStr })),
        lastSource: 'postgres',
        updatedAt: new Date().toISOString(),
      };
      await preferencesRepo.enqueueNotionSync({
        kind: 'pref_page_upsert',
        externalId,
        payload,
        payloadHash: md5Hex(JSON.stringify(payload)),
      });
    } catch {
      // best-effort
    }

    bot.sendMessage(chatId, `Ок. Отключил preference: ${key}`);
  });

  bot.onText(/^\/worker_run\s*$/i, async (msg) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!preferencesRepo) {
      bot.sendMessage(chatId, 'Postgres не настроен. Добавь POSTGRES_URL.');
      return;
    }
    try {
      await pgPool.query('SELECT 1 FROM notion_sync_queue LIMIT 1');
    } catch {
      bot.sendMessage(chatId, 'Не найдена таблица notion_sync_queue. Проверь миграции Postgres.');
      return;
    }

    try {
      const rows = await preferencesRepo.listPreferencesForChat({ chatId, activeOnly: true });
      for (const r of (rows || []).slice(0, 60)) {
        const key = String(r?.pref_key || '').trim();
        if (!key) continue;
        const scope = String(r?.scope || 'global').trim() || 'global';
        const externalId = preferencesRepo.makeExternalId({ chatId, scope, key });
        const categoryRaw = r?.category === null || r?.category === undefined ? null : String(r.category || '').trim() || null;
        const category = categoryRaw === 'memory_note' || categoryRaw === 'settings' ? null : categoryRaw;
        const valueHuman = r?.value_human === null || r?.value_human === undefined ? null : String(r.value_human || '').trim() || null;
        const valueJsonStr = JSON.stringify(r?.value_json || {});
        const payload = {
          externalId,
          chatId,
          scope,
          category,
          key,
          active: true,
          valueHuman,
          valueJson: valueJsonStr,
          syncHash: md5Hex(JSON.stringify({ externalId, chatId, scope, key, active: true, valueHuman, valueJsonStr })),
          lastSource: String(r?.source || 'postgres'),
          updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        };
        await preferencesRepo.enqueueNotionSync({
          kind: 'pref_page_upsert',
          externalId,
          payload,
          payloadHash: md5Hex(JSON.stringify(payload)),
        });
      }
    } catch {
      // best-effort
    }

    const payload = {
      chatId,
      requestedAt: new Date().toISOString(),
      send: false,
      reason: 'manual_admin_command',
    };
    try {
      await preferencesRepo.enqueueNotionSync({
        kind: 'worker_run',
        externalId: `worker_run:chat:${chatId}`,
        payload,
        payloadHash: makeId(JSON.stringify(payload)),
      });
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось поставить worker_run в очередь. Ошибка: ${String(e?.message || e)}`);
      return;
    }

    bot.sendMessage(chatId, 'Ок. Попросил reminders worker сделать синхронизацию memory сейчас. Обычно занимает до 1 минуты.');
  });

  bot.onText(/^\/errors(?:\s+(\d+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!pgPool) {
      bot.sendMessage(chatId, 'Postgres не настроен. Добавь POSTGRES_URL, чтобы работал event_log.');
      return;
    }

    const hours = match && match[1] ? Number(match[1]) : 24;
    const safeHours = Number.isFinite(hours) ? Math.max(1, Math.min(168, Math.trunc(hours))) : 24;
    const sinceIso = new Date(Date.now() - safeHours * 3600_000).toISOString();

    let rows = [];
    try {
      const r = await pgPool.query(
        `select ts, trace_id, component, event, level, left(coalesce(payload::text, ''), 500) as payload
         from event_log
         where chat_id = $1
           and ts >= $2::timestamptz
           and level = 'error'
         order by ts desc
         limit 50`,
        [chatId, sinceIso]
      );
      rows = r.rows || [];
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось прочитать event_log. Проверь миграции Postgres. Ошибка: ${String(e?.message || e)}`);
      return;
    }

    if (!rows.length) {
      bot.sendMessage(chatId, `Ошибок в event_log за последние ${safeHours}ч не нашел.`);
      return;
    }

    const counts = new Map();
    for (const r of rows) {
      const c = String(r.component || 'unknown');
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const top = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const lines = [];
    lines.push(`Ошибки (event_log) за последние ${safeHours}ч:`);
    lines.push(`- всего: ${rows.length}`);
    if (top) lines.push(`- по компонентам: ${top}`);
    lines.push('');
    for (const r of rows) {
      const ts = r.ts ? String(r.ts).replace('T', ' ').slice(0, 19) : '?';
      const trace = r.trace_id ? String(r.trace_id).slice(0, 24) : 'no-trace';
      const payload = r.payload ? String(r.payload).replace(/\s+/g, ' ').trim() : '';
      lines.push(`- ${ts} component=${r.component} event=${r.event} trace=${trace} payload=${truncate(payload, 300)}`);
    }

    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

  bot.onText(/^\/chat_history(?:\s+(\d+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!pgPool || !chatMemoryRepo) {
      bot.sendMessage(chatId, 'Chat memory недоступна. Проверь POSTGRES_URL и миграцию infra/db/migrations/006_chat_memory.sql.');
      return;
    }
    if (!(await isChatMemoryEnabledForChat(chatId))) {
      bot.sendMessage(chatId, 'Chat memory отключена для этого чата (preference: chat_memory_enabled).');
      return;
    }

    const nRaw = match && match[1] ? Number(match[1]) : 30;
    const n = Number.isFinite(nRaw) ? Math.max(5, Math.min(80, Math.trunc(nRaw))) : 30;
    let rows = [];
    try {
      rows = await chatMemoryRepo.listLastN({ chatId, limit: n });
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось прочитать chat_messages. Ошибка: ${String(e?.message || e)}`);
      return;
    }
    if (!rows.length) {
      bot.sendMessage(chatId, '(chat memory пустая)');
      return;
    }

    const lines = [`Chat history (последние ${rows.length}):`, ''];
    for (const r of rows) {
      const ts = formatTsInTzShort(r?.created_at || null, tz);
      const role = String(r?.role || 'unknown');
      const mid = r?.tg_message_id ? `#${r.tg_message_id}` : '-';
      const text = oneLinePreview(String(r?.text || ''), 400);
      if (!text) continue;
      lines.push(`${ts} ${role} ${mid}: ${text}`);
    }
    lines.push('');
    lines.push('Подсказка: /chat_find слово');
    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

  bot.onText(/^\/chat_find(?:\s+(.+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!pgPool || !chatMemoryRepo) {
      bot.sendMessage(chatId, 'Chat memory недоступна. Проверь POSTGRES_URL и миграцию infra/db/migrations/006_chat_memory.sql.');
      return;
    }
    if (!(await isChatMemoryEnabledForChat(chatId))) {
      bot.sendMessage(chatId, 'Chat memory отключена для этого чата (preference: chat_memory_enabled).');
      return;
    }

    const q = match && match[1] ? String(match[1]).trim() : '';
    if (!q) {
      bot.sendMessage(chatId, 'Укажи текст для поиска. Пример: /chat_find execution_history');
      return;
    }

    let rows = [];
    try {
      const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      const r = await pgPool.query(
        `select role, text, tg_message_id, created_at
         from chat_messages
         where chat_id = $1
           and text ilike $2 escape '\\\\'
         order by id desc
         limit 30`,
        [chatId, like]
      );
      rows = r.rows || [];
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось сделать поиск по chat_messages. Ошибка: ${String(e?.message || e)}`);
      return;
    }

    if (!rows.length) {
      bot.sendMessage(chatId, `Ничего не нашел по: "${truncate(q, 40)}"`);
      return;
    }

    const lines = [`Chat find: "${truncate(q, 60)}" (первые ${rows.length}):`, ''];
    for (const r of rows) {
      const ts = formatTsInTzShort(r?.created_at || null, tz);
      const role = String(r?.role || 'unknown');
      const mid = r?.tg_message_id ? `#${r.tg_message_id}` : '-';
      const text = oneLinePreview(String(r?.text || ''), 400);
      if (!text) continue;
      lines.push(`${ts} ${role} ${mid}: ${text}`);
    }
    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

  bot.onText(/^\/chat_at(?:\s+(\d{1,2}[:.]\d{2})(?:\s+(\d{1,2}))?)?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!pgPool || !chatMemoryRepo) {
      bot.sendMessage(chatId, 'Chat memory недоступна. Проверь POSTGRES_URL и миграцию infra/db/migrations/006_chat_memory.sql.');
      return;
    }
    if (!(await isChatMemoryEnabledForChat(chatId))) {
      bot.sendMessage(chatId, 'Chat memory отключена для этого чата (preference: chat_memory_enabled).');
      return;
    }
    const hm = match && match[1] ? String(match[1]).trim() : '';
    const w = match && match[2] ? Number(match[2]) : 1;
    if (!hm) {
      bot.sendMessage(chatId, 'Укажи время. Пример: /chat_at 04:11');
      return;
    }
    await sendChatAtTime({ chatId, ymd: yyyyMmDdInTz({ tz }), hm, windowMin: w });
  });

  bot.onText(/^\/chat_summary(?:\s+(\d{1,2}(?:[:.]\d{2})?)\s+(\d{1,2}(?:[:.]\d{2})?))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!pgPool || !chatMemoryRepo) {
      bot.sendMessage(chatId, 'Chat memory недоступна. Проверь POSTGRES_URL и миграцию infra/db/migrations/006_chat_memory.sql.');
      return;
    }
    if (!(await isChatMemoryEnabledForChat(chatId))) {
      bot.sendMessage(chatId, 'Chat memory отключена для этого чата (preference: chat_memory_enabled).');
      return;
    }

    const aRaw = match && match[1] ? String(match[1]).trim() : '';
    const bRaw = match && match[2] ? String(match[2]).trim() : '';
    if (!aRaw || !bRaw) {
      bot.sendMessage(chatId, 'Укажи диапазон. Пример: /chat_summary 02:00 03:00');
      return;
    }
    const a = parseHmToken(aRaw);
    const b = parseHmToken(bRaw);
    if (!a || !b) {
      bot.sendMessage(chatId, 'Неверный формат времени. Пример: /chat_summary 02:00 03:00');
      return;
    }
    await sendChatSummaryRange({
      chatId,
      ymd: yyyyMmDdInTz({ tz }),
      fromHm: `${pad2(a.hh)}:${pad2(a.mm)}`,
      toHm: `${pad2(b.hh)}:${pad2(b.mm)}`,
      callChatCompletions,
    });
  });

  bot.onText(/^\/history_list(?:\s+(\d+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const limitRaw = match && match[1] ? Number(match[1]) : 20;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 20;
    let files = [];
    try {
      files = listExecutionHistoryFiles();
    } catch (e) {
      bot.sendMessage(chatId, `Не получилось прочитать execution_history. Ошибка: ${String(e?.message || e)}`);
      return;
    }

    const slice = files.slice(0, limit).map((f, i) => ({ index: i + 1, file: f }));
    lastShownHistoryByChatId.set(chatId, slice);
    if (!slice.length) {
      bot.sendMessage(chatId, 'В execution_history нет sprint файлов.');
      return;
    }
    const lines = ['Execution history (последние файлы):', ''];
    for (const it of slice) lines.push(`${it.index}. ${it.file}`);
    lines.push('');
    lines.push('Чтобы посмотреть: /history_show 3 или /history_show 2026-01-05_admin_cmds.md');
    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

  bot.onText(/^\/history_show(?:\s+(.+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const arg = match && match[1] ? String(match[1]).trim() : '';
    if (!arg) {
      bot.sendMessage(chatId, 'Укажи номер из /history_list или имя файла. Пример: /history_show 3');
      return;
    }

    const byIndex = Number(arg);
    let file = null;
    if (Number.isFinite(byIndex)) {
      const list = lastShownHistoryByChatId.get(chatId) || [];
      const found = list.find((x) => x.index === Math.trunc(byIndex));
      file = found ? found.file : null;
      if (!file) {
        bot.sendMessage(chatId, 'Не нашел этот номер в последнем /history_list. Сначала вызови /history_list.');
        return;
      }
    } else {
      const all = listExecutionHistoryFiles();
      const want = arg.endsWith('.md') ? arg : `${arg}.md`;
      file = all.find((x) => x === want) || all.find((x) => x.includes(arg)) || null;
      if (!file) {
        bot.sendMessage(chatId, 'Не нашел такой файл. Сначала вызови /history_list.');
        return;
      }
    }

    const md = readExecutionHistoryFileSafe(file);
    if (!md) {
      bot.sendMessage(chatId, 'Не получилось прочитать файл.');
      return;
    }
    const digest = extractSprintDigest(md);
    if (!digest) {
      bot.sendMessage(chatId, `Файл: ${file}\n\n(не смог собрать конспект, возможно формат отличается)`);
      return;
    }
    await sendLongMessage({ bot, chatId, text: [`Файл: ${file}`, '', digest].join('\n') });
  });

  bot.onText(/^\/history_summary(?:\s+(\d+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    const daysRaw = match && match[1] ? Number(match[1]) : 3;
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, Math.trunc(daysRaw))) : 3;

    const today = new Date();
    const yyyy = String(today.getUTCFullYear()).padStart(4, '0');
    const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(today.getUTCDate()).padStart(2, '0');
    const todayYmd = `${yyyy}-${mm}-${dd}`;

    const cutoffDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (days - 1) * 24 * 60 * 60 * 1000);
    const cy = String(cutoffDate.getUTCFullYear()).padStart(4, '0');
    const cm = String(cutoffDate.getUTCMonth() + 1).padStart(2, '0');
    const cd = String(cutoffDate.getUTCDate()).padStart(2, '0');
    const cutoffYmd = `${cy}-${cm}-${cd}`;

    const all = listExecutionHistoryFiles();
    const picked = all.filter((f) => {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})_/);
      if (!m) return false;
      const d0 = m[1];
      return d0 >= cutoffYmd && d0 <= todayYmd;
    });

    if (!picked.length) {
      bot.sendMessage(chatId, `Не нашел sprint файлов за последние ${days} дней.`);
      return;
    }

    const lines = [];
    lines.push(`Summary по execution_history за последние ${days} дней:`);
    lines.push('');
    for (const f of picked.slice(0, 20)) {
      const md = readExecutionHistoryFileSafe(f);
      if (!md) continue;
      const digest = extractSprintDigest(md);
      const one = digest ? splitTelegramText(digest, 900)[0] : null;
      lines.push(`- ${f}`);
      if (one) lines.push(`  ${oneLinePreview(one.replace(/\n+/g, ' '), 220)}`);
    }

    await sendLongMessage({ bot, chatId, text: lines.join('\n') });
  });

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
    const allowlistedCount = rows.filter((r) => Boolean(r.allowlisted)).length;

    let pgInfo = null;
    try {
      const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
      if (cs) {
        const u = new URL(cs);
        const db = String(u.pathname || '').replace(/^\//, '') || null;
        const port = u.port ? String(u.port) : '5432';
        pgInfo = `${u.hostname}:${port}${db ? `/${db}` : ''}`;
      }
    } catch {
      pgInfo = null;
    }

    bot.sendMessage(
      chatId,
      [
        `Security status:`,
        `- backend: ${chatSecurity.backendName()}`,
        `- postgres: ${pgInfo || '-'}`,
        `- allowlist_mode: ${chatSecurity.allowlistMode || 'off'}`,
        `- known chats: ${rows.length}`,
        `- allowlisted: ${allowlistedCount}`,
        `- revoked: ${revokedCount}`,
      ].join('\n')
    );
  });

  bot.onText(/^\/allow_here\s*$/i, async (msg) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    try {
      await chatSecurity.allowChat({ actorChatId, targetChatId: actorChatId });
      bot.sendMessage(actorChatId, 'Ок. Этот чат добавлен в allowlist.');
    } catch (e) {
      bot.sendMessage(actorChatId, `Не получилось добавить чат в allowlist. Ошибка: ${String(e?.message || e)}`);
    }
  });

  bot.onText(/^\/allow\s+(\d+)\s*$/i, async (msg, match) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    const targetChatId = Number(match[1]);
    try {
      await chatSecurity.allowChat({ actorChatId, targetChatId });
      bot.sendMessage(actorChatId, `Ок. Добавил чат ${targetChatId} в allowlist.`);
    } catch (e) {
      bot.sendMessage(actorChatId, `Не получилось добавить чат в allowlist. Ошибка: ${String(e?.message || e)}`);
    }
  });

  bot.onText(/^\/unallow_here\s*$/i, async (msg) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    try {
      await chatSecurity.unallowChat({ actorChatId, targetChatId: actorChatId });
      bot.sendMessage(actorChatId, 'Ок. Этот чат удален из allowlist.');
    } catch (e) {
      bot.sendMessage(actorChatId, `Не получилось удалить чат из allowlist. Ошибка: ${String(e?.message || e)}`);
    }
  });

  bot.onText(/^\/unallow\s+(\d+)\s*$/i, async (msg, match) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    const targetChatId = Number(match[1]);
    try {
      await chatSecurity.unallowChat({ actorChatId, targetChatId });
      bot.sendMessage(actorChatId, `Ок. Удалил чат ${targetChatId} из allowlist.`);
    } catch (e) {
      bot.sendMessage(actorChatId, `Не получилось удалить чат из allowlist. Ошибка: ${String(e?.message || e)}`);
    }
  });

  bot.onText(/^\/revoke_here(?:\s+(.+))?\s*$/i, async (msg, match) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    const reason = match && match[1] ? String(match[1]).trim() : null;
    try {
      await chatSecurity.revokeChat({ actorChatId, targetChatId: actorChatId, reason });
      bot.sendMessage(actorChatId, 'Ок. Этот чат отключен (revoked).');
    } catch (e) {
      bot.sendMessage(actorChatId, `Не получилось отключить чат. Ошибка: ${String(e?.message || e)}`);
    }
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
    try {
      await chatSecurity.revokeChat({ actorChatId, targetChatId, reason });
      bot.sendMessage(actorChatId, `Ок. Отключил чат ${targetChatId}.`);
    } catch (e) {
      bot.sendMessage(actorChatId, `Не получилось отключить чат ${targetChatId}. Ошибка: ${String(e?.message || e)}`);
    }
  });

  bot.onText(/^\/unrevoke\s+(\d+)\s*$/i, async (msg, match) => {
    const actorChatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(actorChatId)) {
      bot.sendMessage(actorChatId, 'Команда доступна только админам.');
      return;
    }
    const targetChatId = Number(match[1]);
    try {
      await chatSecurity.unrevokeChat({ actorChatId, targetChatId });
      bot.sendMessage(actorChatId, `Ок. Вернул доступ для чата ${targetChatId}.`);
    } catch (e) {
      bot.sendMessage(actorChatId, `Не получилось вернуть доступ для чата ${targetChatId}. Ошибка: ${String(e?.message || e)}`);
    }
  });

  // /logs [hours] - экспорт логов (event_log + chat_messages) за последние N часов
  bot.onText(/^\/logs(?:\s+(\d+))?\s*$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    await chatSecurity.touchFromMsg(msg);
    if (!chatSecurity.isAdminChat(chatId)) {
      bot.sendMessage(chatId, 'Команда доступна только админам.');
      return;
    }
    if (!pgPool) {
      bot.sendMessage(chatId, 'Postgres не настроен. Добавь POSTGRES_URL.');
      return;
    }

    const hours = match && match[1] ? Number(match[1]) : 24;
    const safeHours = Number.isFinite(hours) ? Math.max(1, Math.min(168, Math.trunc(hours))) : 24;
    const sinceIso = new Date(Date.now() - safeHours * 3600_000).toISOString();

    bot.sendMessage(chatId, `Собираю логи за последние ${safeHours}ч...`);

    try {
      // 1. event_log
      const eventLogRes = await pgPool.query(
        `SELECT id, ts, trace_id, chat_id, tg_update_id, tg_message_id, component, event, level, duration_ms, payload
         FROM event_log
         WHERE ts >= $1::timestamptz
         ORDER BY ts DESC
         LIMIT 1000`,
        [sinceIso]
      );

      // 2. chat_messages
      const chatMessagesRes = await pgPool.query(
        `SELECT id, chat_id, role, text, tg_message_id, created_at
         FROM chat_messages
         WHERE created_at >= $1::timestamptz
         ORDER BY created_at DESC
         LIMIT 500`,
        [sinceIso]
      );

      const exportData = {
        exportedAt: new Date().toISOString(),
        periodHours: safeHours,
        sinceIso,
        eventLog: {
          count: eventLogRes.rows.length,
          rows: eventLogRes.rows,
        },
        chatMessages: {
          count: chatMessagesRes.rows.length,
          rows: chatMessagesRes.rows,
        },
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const filename = `logs_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;

      // Отправляем как документ
      await bot.sendDocument(chatId, Buffer.from(jsonStr, 'utf8'), {}, { filename, contentType: 'application/json' });

      const summary = [
        `Логи за ${safeHours}ч:`,
        `- event_log: ${eventLogRes.rows.length} записей`,
        `- chat_messages: ${chatMessagesRes.rows.length} записей`,
      ].join('\n');
      bot.sendMessage(chatId, summary);
    } catch (e) {
      bot.sendMessage(chatId, `Ошибка при экспорте логов: ${String(e?.message || e)}`);
    }
  });

  return { maybeHandleAdminChatMemoryNaturalLanguage };
}

module.exports = { registerAdminCommands };


