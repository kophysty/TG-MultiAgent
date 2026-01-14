/**
 * Генератор датасета для тестирования Memory и Preferences
 *
 * Категории:
 * - memory_note (сохранение) (25)
 * - preference extractor (20)
 * - clarify (неполные) (10)
 * - /prefs_pg команда (10)
 * - /prefs_rm удаление (10)
 * - Негативные кейсы (5)
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

// Seed random for reproducibility
let seed = 20260113;
function seededRandom() {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

function seededShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========== Генераторы категорий ==========

function genMemoryNote(defaults) {
  const cases = [];

  const memoryTexts = seededShuffle([
    // Базовые формулировки
    { t: 'запомни что я предпочитаю краткие ответы', note: 'я предпочитаю краткие ответы' },
    { t: 'запомни: работаю по московскому времени', note: 'работаю по московскому времени' },
    { t: 'запомни - я не люблю эмодзи', note: 'я не люблю эмодзи' },
    { t: 'добавь в память: работаю с Notion', note: 'работаю с Notion' },
    { t: 'сохрани в память: дефолтная категория Work', note: 'дефолтная категория Work' },
    { t: 'занеси в память: предпочитаю списки', note: 'предпочитаю списки' },
    { t: 'зафиксируй в память: таймзон MSK', note: 'таймзон MSK' },
    { t: 'внеси в память: отвечай на русском', note: 'отвечай на русском' },
    // Разные формулировки
    { t: 'запомни в память что мы постим в телеграм', note: 'мы постим в телеграм' },
    { t: 'добавь в постоянную память: проект AI бот', note: 'проект AI бот' },
    { t: 'пожалуйста запомни что приоритеты High', note: 'приоритеты High' },
    { t: 'запомнить: напоминай про дедлайны', note: 'напоминай про дедлайны' },
    { t: 'запомните: использую GTD методологию', note: 'использую GTD методологию' },
    // Английские варианты
    { t: 'remember: we post to telegram', note: 'we post to telegram' },
    { t: 'remember we work with Notion', note: 'we work with Notion' },
    { t: 'remember in memory: default priority Medium', note: 'default priority Medium' },
    // Контекстные
    { t: 'запомни что сейчас работаю над ботом', note: 'сейчас работаю над ботом' },
    { t: 'добавь в память что люблю утренние созвоны', note: 'люблю утренние созвоны' },
    { t: 'запомни: предпочитаю таблицы вместо текста', note: 'предпочитаю таблицы вместо текста' },
    { t: 'сохрани: не использовать markdown', note: 'не использовать markdown' },
    { t: 'запомни что работаю в AI стартапе', note: 'работаю в AI стартапе' },
    { t: 'в память: команда из 5 человек', note: 'команда из 5 человек' },
    { t: 'добавь: главный проект TG-MultiAgent', note: 'главный проект TG-MultiAgent' },
    { t: 'запомни - рабочие часы с 10 до 19', note: 'рабочие часы с 10 до 19' },
    { t: 'сохрани в память: пишу на JavaScript', note: 'пишу на JavaScript' },
  ]);

  for (const item of memoryTexts.slice(0, 25)) {
    cases.push({
      id: `mem_note_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: {
        type: 'chat',
        chatContainsAnyOf: ['запомнил', 'сохранил', 'зафиксировал', 'добавил'],
      },
      expectedNote: item.note,
    });
  }

  return cases;
}

function genPreferenceExtractor(defaults) {
  const cases = [];

  const prefTexts = seededShuffle([
    // Явные preferences
    { t: 'по умолчанию отвечай коротко', key: 'response_style' },
    { t: 'всегда отвечай без эмодзи', key: 'no_emoji' },
    { t: 'никогда не используй эмодзи', key: 'no_emoji' },
    { t: 'обычно отвечай подробно', key: 'response_style' },
    { t: 'таймзона Europe/Moscow', key: 'timezone' },
    { t: 'timezone MSK', key: 'timezone' },
    { t: 'предпочитаю таблицы', key: 'format_preference' },
    { t: 'отвечай списками когда возможно', key: 'format_preference' },
    { t: 'дефолтный приоритет Medium', key: 'default_priority' },
    { t: 'всегда показывай дедлайны', key: 'show_deadlines' },
    { t: 'по умолчанию не включай выполненные', key: 'hide_done' },
    // Неявные preferences
    { t: 'мне нравятся короткие ответы', key: 'response_style' },
    { t: 'лучше отвечай подробно с примерами', key: 'response_style' },
    { t: 'хочу видеть дедлайны всегда', key: 'show_deadlines' },
    { t: 'добавляй задачи в Work по умолчанию', key: 'default_category' },
    { t: 'обычно работаю над AI проектом', key: 'work_context' },
    { t: 'предпочитаю получать напоминания утром', key: 'reminder_time' },
    { t: 'мне удобнее в 10 утра', key: 'preferred_time' },
    { t: 'всегда сортируй по приоритету', key: 'sort_preference' },
    { t: 'группируй задачи по категориям', key: 'group_preference' },
  ]);

  for (const item of prefTexts.slice(0, 20)) {
    cases.push({
      id: `pref_ext_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['chat', 'tool'] },
      expectedPrefKey: item.key,
    });
  }

  return cases;
}

function genClarify(defaults) {
  const cases = [];

  // Неполные команды - агент должен переспросить
  const clarifyTexts = seededShuffle([
    'запомни',
    'запомни:',
    'добавь в память',
    'добавь в память:',
    'сохрани в память',
    'пожалуйста запомни:',
    'зафиксируй',
    'в память:',
    'remember',
    'remember:',
  ]);

  for (const t of clarifyTexts.slice(0, 10)) {
    cases.push({
      id: `mem_clarify_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: {
        type: 'chat',
        chatContainsAnyOf: ['что', 'уточни', '?'],
      },
    });
  }

  return cases;
}

function genPrefsPg(defaults) {
  const cases = [];

  // Команда /prefs_pg для просмотра preferences из Postgres
  const prefsPgTexts = seededShuffle([
    '/prefs_pg',
    '/prefs_pg ', // с пробелом
    'покажи мои предпочтения',
    'какие у меня preferences',
    'мои настройки',
    'что ты обо мне помнишь',
    'какие у меня сохраненные настройки',
    'покажи сохраненные предпочтения',
    'list preferences',
    'show my prefs',
  ]);

  for (const t of prefsPgTexts.slice(0, 10)) {
    cases.push({
      id: `prefs_pg_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: {
        typeAnyOf: ['chat', 'tool'],
        // Команда /prefs_pg обрабатывается детерминированно
      },
    });
  }

  return cases;
}

function genPrefsRm(defaults) {
  const cases = [];

  // Команда /prefs_rm для удаления preference
  const prefsRmTexts = seededShuffle([
    '/prefs_rm 1',
    '/prefs_rm 2',
    '/prefs_rm timezone',
    '/prefs_rm response_style',
    '/prefs_rm no_emoji',
    'удали предпочтение 1',
    'убери настройку timezone',
    'отключи preference 2',
    'забудь про настройку 3',
    'удали из preferences первую',
  ]);

  for (const t of prefsRmTexts.slice(0, 10)) {
    cases.push({
      id: `prefs_rm_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['chat', 'tool'] },
    });
  }

  return cases;
}

function genNegative(defaults) {
  const cases = [];

  // Негативные кейсы - то что не должно сохраняться
  const negativeTexts = seededShuffle([
    // Секреты/пароли
    { t: 'запомни пароль 123456', shouldReject: true },
    { t: 'сохрани токен sk-abcd1234', shouldReject: true },
    { t: 'добавь в память API key', shouldReject: true },
    // Персональные данные
    { t: 'запомни мой номер карты 4111', shouldReject: true },
    // Бессмысленные
    { t: 'запомни ааааааааааа', shouldReject: false },
  ]);

  for (const item of negativeTexts.slice(0, 5)) {
    cases.push({
      id: `mem_neg_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['chat', 'tool'] },
      shouldReject: item.shouldReject,
    });
  }

  return cases;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const tz = 'Europe/Moscow';
  const nowIso = isoZ(2026, 1, 13, 9, 0, 0);
  const defaults = { tz, nowIso };

  const allCases = [];

  // memory_note (25)
  allCases.push(...genMemoryNote(defaults));

  // preference extractor (20)
  allCases.push(...genPreferenceExtractor(defaults));

  // clarify (10)
  allCases.push(...genClarify(defaults));

  // /prefs_pg (10)
  allCases.push(...genPrefsPg(defaults));

  // /prefs_rm (10)
  allCases.push(...genPrefsRm(defaults));

  // Negative cases (5)
  allCases.push(...genNegative(defaults));

  // Ensure exactly 80
  while (allCases.length < 80) {
    allCases.push({
      id: `mem_pad_${allCases.length}`,
      userText: `запомни тест ${allCases.length}`,
      tz,
      nowIso,
      expected: { typeAnyOf: ['chat', 'tool'] },
    });
  }
  if (allCases.length > 80) {
    allCases.length = 80;
  }

  const outPath = path.join(repoRoot, 'apps', 'evals', 'ds', '10_2026-01-13_memory_prefs_80.jsonl');
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
