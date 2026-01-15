/**
 * Генератор датасета для контекстно-зависимых тестов
 *
 * Категории:
 * - С chatHistory (15)
 * - С workContext (10)
 * - С memorySummary (10)
 * - Референс к предыдущему с заполненным lastShownList (15)
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

// ========== Mock контексты ==========

const sampleChatHistory = [
  { role: 'user', content: 'покажи задачи на сегодня' },
  { role: 'assistant', content: 'Задачи на сегодня:\n1. Созвон с командой\n2. Код ревью\n3. Написать документацию' },
  { role: 'user', content: 'добавь задачу подготовить релиз' },
  { role: 'assistant', content: 'Создал задачу "Подготовить релиз"' },
  { role: 'user', content: 'какой у нее приоритет?' },
  { role: 'assistant', content: 'Приоритет: Medium. Хотите изменить?' },
];

const sampleWorkContext = {
  project: 'TG-MultiAgent',
  type: 'AI Bot',
  tech: ['Node.js', 'Telegram API', 'Notion API', 'OpenAI'],
  team: ['Developer', 'PM'],
};

const sampleMemorySummary = [
  'Предпочитает краткие ответы',
  'Работает по московскому времени',
  'Не любит эмодзи',
  'Дефолтная категория Work',
  'Работает над AI ботом',
];

const lastShownList = [
  { index: 1, id: 't1', title: 'Созвон с командой' },
  { index: 2, id: 't2', title: 'Код ревью' },
  { index: 3, id: 't3', title: 'Написать документацию' },
  { index: 4, id: 't4', title: 'Подготовить релиз' },
  { index: 5, id: 't5', title: 'Тестирование API' },
];

const lastShownIdeasList = [
  { index: 1, id: 'i1', title: 'Темная тема' },
  { index: 2, id: 'i2', title: 'Push уведомления' },
  { index: 3, id: 'i3', title: 'AI подсказки' },
];

const lastShownSocialList = [
  { index: 1, id: 's1', title: 'Анонс релиза' },
  { index: 2, id: 's2', title: 'Tips and tricks' },
];

// ========== Генераторы категорий ==========

function genWithChatHistory(defaults) {
  const cases = [];

  const chatHistoryTexts = seededShuffle([
    // Референс к предыдущим сообщениям
    { t: 'что мы обсуждали?', chatRef: true },
    { t: 'напомни про релиз', chatRef: true },
    { t: 'какие задачи мы добавляли?', chatRef: true },
    { t: 'что там с приоритетом?', chatRef: true },
    { t: 'вернемся к созвону', chatRef: true },
    { t: 'а что по документации?', chatRef: true },
    { t: 'какой был последний вопрос?', chatRef: true },
    { t: 'продолжим с того места', chatRef: true },
    { t: 'еще раз про задачи', chatRef: true },
    { t: 'что там было про ревью?', chatRef: true },
    // Уточняющие вопросы
    { t: 'да, измени его', chatRef: true },
    { t: 'нет, оставь как есть', chatRef: true },
    { t: 'покажи подробнее', chatRef: true },
    { t: 'добавь еще одну такую же', chatRef: true },
    { t: 'удали последнюю', chatRef: true },
  ]);

  for (const item of chatHistoryTexts.slice(0, 15)) {
    cases.push({
      id: `ctx_chat_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      chatHistory: sampleChatHistory,
      expected: { typeAnyOf: ['tool', 'chat'] },
    });
  }

  return cases;
}

function genWithWorkContext(defaults) {
  const cases = [];

  const workContextTexts = seededShuffle([
    // Вопросы про рабочий контекст
    { t: 'покажи рабочие задачи', useContext: true },
    { t: 'что там по проекту?', useContext: true },
    { t: 'задачи по AI боту', useContext: true },
    { t: 'добавь задачу в текущий проект', useContext: true },
    { t: 'покажи задачи команды', useContext: true },
    { t: 'что делать сегодня по работе?', useContext: true },
    { t: 'задачи связанные с Telegram API', useContext: true },
    { t: 'покажи задачи по Node.js', useContext: true },
    { t: 'что по интеграции с Notion?', useContext: true },
    { t: 'задачи для PM', useContext: true },
  ]);

  for (const item of workContextTexts.slice(0, 10)) {
    cases.push({
      id: `ctx_work_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      workContext: sampleWorkContext,
      expected: { typeAnyOf: ['tool', 'chat'] },
    });
  }

  return cases;
}

function genWithMemorySummary(defaults) {
  const cases = [];

  const memorySummaryTexts = seededShuffle([
    // Вопросы про сохраненную память
    { t: 'какие у меня предпочтения?', useMem: true },
    { t: 'что ты обо мне помнишь?', useMem: true },
    { t: 'покажи мои настройки', useMem: true },
    { t: 'какой у меня таймзон?', useMem: true },
    { t: 'какая дефолтная категория?', useMem: true },
    { t: 'над чем я работаю?', useMem: true },
    { t: 'использую ли я эмодзи?', useMem: true },
    { t: 'как мне отвечать?', useMem: true },
    { t: 'какие мои привычки?', useMem: true },
    { t: 'расскажи что знаешь обо мне', useMem: true },
  ]);

  for (const item of memorySummaryTexts.slice(0, 10)) {
    cases.push({
      id: `ctx_mem_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      memorySummary: sampleMemorySummary,
      expected: { typeAnyOf: ['tool', 'chat'] },
    });
  }

  return cases;
}

function genWithLastShown(defaults) {
  const cases = [];

  // Референсы с заполненным lastShownList
  const lastShownTexts = seededShuffle([
    // Tasks
    { t: 'обнови первую', list: 'tasks', idx: 1 },
    { t: 'удали вторую', list: 'tasks', idx: 2 },
    { t: 'третью в Done', list: 'tasks', idx: 3 },
    { t: 'четвертую - приоритет High', list: 'tasks', idx: 4 },
    { t: 'отметь пятую выполненной', list: 'tasks', idx: 5 },
    { t: 'первые две удали', list: 'tasks', idx: 1 },
    { t: 'последнюю обнови', list: 'tasks', idx: 5 },
    // Ideas
    { t: 'первую идею архивируй', list: 'ideas', idx: 1 },
    { t: 'вторую идею в Review', list: 'ideas', idx: 2 },
    { t: 'обнови третью идею', list: 'ideas', idx: 3 },
    // Social
    { t: 'первый пост на завтра', list: 'social', idx: 1 },
    { t: 'второй пост в Draft', list: 'social', idx: 2 },
    // Mixed context
    { t: 'её в Work', list: 'tasks', idx: null, needsRef: true },
    { t: 'это удали', list: 'tasks', idx: null, needsRef: true },
    { t: 'перенеси на завтра', list: 'tasks', idx: null, needsRef: true },
  ]);

  for (const item of lastShownTexts.slice(0, 15)) {
    const c = {
      id: `ctx_ref_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['tool', 'chat'] },
    };

    // Добавляем соответствующий lastShown*List
    if (item.list === 'tasks') {
      c.lastShownList = lastShownList;
    } else if (item.list === 'ideas') {
      c.lastShownIdeasList = lastShownIdeasList;
    } else if (item.list === 'social') {
      c.lastShownSocialList = lastShownSocialList;
    }

    // Добавляем chatHistory если нужен референс к "ней/этому"
    if (item.needsRef) {
      c.chatHistory = [
        { role: 'user', content: 'покажи задачи' },
        { role: 'assistant', content: 'Задачи:\n1. Созвон с командой' },
      ];
    }

    cases.push(c);
  }

  return cases;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const tz = 'Europe/Moscow';
  const nowIso = isoZ(2026, 1, 13, 9, 0, 0);
  const defaults = { tz, nowIso };

  const allCases = [];

  // С chatHistory (15)
  allCases.push(...genWithChatHistory(defaults));

  // С workContext (10)
  allCases.push(...genWithWorkContext(defaults));

  // С memorySummary (10)
  allCases.push(...genWithMemorySummary(defaults));

  // Референс к предыдущему с lastShownList (15)
  allCases.push(...genWithLastShown(defaults));

  // Ensure exactly 50
  while (allCases.length < 50) {
    allCases.push({
      id: `ctx_pad_${allCases.length}`,
      userText: 'обнови первую',
      tz,
      nowIso,
      lastShownList,
      expected: { typeAnyOf: ['tool', 'chat'] },
    });
  }
  if (allCases.length > 50) {
    allCases.length = 50;
  }

  const outPath = path.join(repoRoot, 'apps', 'evals', 'ds', '12_2026-01-13_context_dependent_50.jsonl');
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

