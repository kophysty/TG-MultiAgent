const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex').slice(0, 8);
}

function makeId(prefix, obj) {
  return `${prefix}_${md5(JSON.stringify(obj || {}))}`;
}

function isoZ(y, m, d, hh, mm, ss = 0) {
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
  const outPath = path.join(repoRoot, 'apps', 'evals', 'ds', '01_2026-01-06_planner_150.jsonl');

  // Time anchors:
  // - Morning-ish: 2026-01-06 10:55 MSK = 07:55Z
  // - After reminders: 2026-01-06 12:05 MSK = 09:05Z
  const nowMorningIso = isoZ(2026, 1, 6, 7, 55, 0);
  const nowNoonIso = isoZ(2026, 1, 6, 9, 5, 0);
  const tz = 'Europe/Moscow';

  // Stable reference dates relative to 2026-01-06
  const D_TODAY = '2026-01-06';
  const D_TOMORROW = '2026-01-07';
  const D_AFTER = '2026-01-08';
  const D_NEXTDAY3 = '2026-01-09';

  const lastShownList = [
    { index: 1, id: 't1', title: 'Купить молоко' },
    { index: 2, id: 't2', title: 'Позвонить маме' },
    { index: 3, id: 't3', title: 'Оплатить интернет' },
    { index: 4, id: 't4', title: 'Сделать зарядку' },
    { index: 5, id: 't5', title: 'Написать пост' },
    { index: 6, id: 't6', title: 'Подготовить созвон' },
    { index: 7, id: 't7', title: 'Разобрать inbox' },
    { index: 8, id: 't8', title: 'Купить билеты' },
    { index: 9, id: 't9', title: 'Обновить резюме' },
    { index: 10, id: 't10', title: 'Прочитать статью' },
  ];

  const lastShownIdeasList = [
    { index: 1, id: 'i1', title: 'Идея про контент-план' },
    { index: 2, id: 'i2', title: 'Идея про продуктовый онбординг' },
    { index: 3, id: 'i3', title: 'Идея про рефакторинг' },
  ];

  const lastShownSocialList = [
    { index: 1, id: 's1', title: 'Пост про запуск' },
    { index: 2, id: 's2', title: 'Пост про привычки' },
  ];

  const cases = [];

  function addCase(c) {
    const base = {
      id: c.id || makeId('c', { userText: c.userText, expected: c.expected || null }),
      userText: c.userText,
      tz: c.tz || tz,
      nowIso: c.nowIso || nowMorningIso,
    };
    if (c.lastShownList) base.lastShownList = c.lastShownList;
    if (c.lastShownIdeasList) base.lastShownIdeasList = c.lastShownIdeasList;
    if (c.lastShownSocialList) base.lastShownSocialList = c.lastShownSocialList;
    if (c.memorySummary) base.memorySummary = c.memorySummary;
    if (c.chatSummary) base.chatSummary = c.chatSummary;
    if (c.chatHistory) base.chatHistory = c.chatHistory;
    if (c.workContext) base.workContext = c.workContext;
    base.expected = c.expected || null;
    cases.push(base);
  }

  // 1) List tasks (25)
  const listPhrases = [
    { t: 'покажи задачи на сегодня', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ preset: 'today' }, { dueDate: D_TODAY }] } },
    { t: 'какие задачи на сегодня', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'покажи задачи на завтра', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ dueDate: D_TOMORROW }, { preset: 'tomorrow' }, { dueDate: 'tomorrow' }] } },
    { t: 'покажи задачи на послезавтра', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ dueDate: D_AFTER }, { preset: 'day_after_tomorrow' }, { dueDate: 'послезавтра' }] } },
    { t: 'покажи задачи на 8-е', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ dueDate: D_AFTER }] } },
    { t: 'покажи выполненные задачи', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ doneOnly: true }, { status: 'Done' }] } },
    { t: 'покажи все задачи включая выполненные', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ includeDone: true }] } },
    { t: 'покажи рабочие задачи', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ tag: 'Work' }, { tag: 'work' }] } },
    { t: 'покажи домашние задачи', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ tag: 'Home' }, { tag: 'home' }] } },
    { t: 'покажи инбокс', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ tag: 'Inbox' }, { tag: 'inbox' }] } },
  ];
  for (const p of listPhrases) addCase({ userText: p.t, expected: p.exp });
  // add more list noise for week phrases (executor handles range)
  const weekPhrases = [
    'покажи задачи на эту неделю',
    'какие задачи на следующей неделе',
    'покажи задачи на этой неделе по работе',
    'список задач на следующую неделю',
    'покажи задачи на неделю',
    'покажи задачи на неделю и инбокс',
    'покажи список задач',
    'покажи мои задачи',
    'покажи задачи в notion',
    // These MUST stay as list_tasks (not find_tasks) with queryText filter.
    { t: 'список задач по слову купить', q: 'куп' },
    { t: 'покажи задачи купить', q: 'куп' },
    { t: 'покажи задачи про билеты', q: 'билет' },
    { t: 'покажи задачи про созвон', q: 'созвон' },
    'покажи задачи на 9-е',
    'покажи задачи на 2026-01-08',
  ];
  for (const item of weekPhrases) {
    if (typeof item === 'string') {
      addCase({ userText: item, expected: { type: 'tool', toolName: 'notion.list_tasks' } });
    } else {
      addCase({
        userText: item.t,
        expected: { type: 'tool', toolName: 'notion.list_tasks', args: { queryText: { $regex: item.q, $flags: 'i' } } },
      });
    }
  }

  // 2) Create tasks (45)
  const createBase = [
    'добавь задачу купить молоко',
    'создай задачу позвонить маме',
    'добавь задачу оплатить интернет',
    'добавь задачу разобрать инбокс',
    'добавь задачу написать пост',
  ];
  for (const t of createBase) {
    addCase({
      userText: t,
      expected: {
        type: 'tool',
        toolName: 'notion.create_task',
        args: { title: { $regex: '.*', $flags: '' } },
      },
    });
  }
  // due date relative
  const createDates = [
    { t: 'добавь задачу купить билеты на завтра', d: D_TOMORROW },
    { t: 'добавь задачу купить билеты на послезавтра', d: D_AFTER },
    { t: 'добавь задачу подготовить созвон на 8-е', d: D_AFTER },
    { t: 'создай задачу написать пост на 9-е', d: D_NEXTDAY3 },
  ];
  for (const x of createDates) {
    addCase({
      userText: x.t,
      expected: {
        type: 'tool',
        toolName: 'notion.create_task',
        argsAnyOf: [
          { dueDate: x.d },
          { dueDate: { $regex: `^${x.d}`, $flags: '' } },
        ],
      },
    });
  }
  // due date with time (regex)
  const timeCases = [
    { t: 'добавь задачу позвонить маме сегодня в 15:00', d: D_TODAY, hhmm: '15:00' },
    { t: 'добавь задачу купить молоко завтра в 09:30', d: D_TOMORROW, hhmm: '09:30' },
    { t: 'создай задачу подготовить созвон послезавтра в 11:00', d: D_AFTER, hhmm: '11:00' },
  ];
  for (const x of timeCases) {
    const [hh, mm] = x.hhmm.split(':');
    const pattern = `^${x.d}T${hh}:${mm}`;
    addCase({
      userText: x.t,
      expected: {
        type: 'tool',
        toolName: 'notion.create_task',
        args: { dueDate: { $regex: pattern, $flags: '' } },
      },
    });
  }
  // bulk create with variations
  const nouns = ['прочитать статью', 'обновить резюме', 'купить билеты', 'сделать зарядку', 'разобрать inbox'];
  const dates = [null, D_TODAY, D_TOMORROW, D_AFTER];
  let idx = 0;
  for (const n of nouns) {
    for (const d of dates) {
      idx += 1;
      const text = d ? `добавь задачу ${n} на ${d}` : `добавь задачу ${n}`;
      addCase({
        userText: text,
        expected: d
          ? { type: 'tool', toolName: 'notion.create_task', argsAnyOf: [{ dueDate: d }, { dueDate: { $regex: `^${d}`, $flags: '' } }] }
          : { type: 'tool', toolName: 'notion.create_task' },
      });
    }
  }
  // categories
  const catCases = [
    'добавь рабочую задачу подготовить презентацию',
    'создай домашнюю задачу убрать квартиру',
    'добавь задачу в инбокс проверить почту',
  ];
  for (const t of catCases) addCase({ userText: t, expected: { type: 'tool', toolName: 'notion.create_task' } });

  // 3) Update tasks (30)
  const updates = [
    { t: 'переименуй задачу 2 в позвонить врачу', args: { taskIndex: 2, title: 'позвонить врачу' } },
    { t: 'обнови задачу 3 приоритет на High', args: { taskIndex: 3, priority: 'High' } },
    // Allow YYYY-MM-DD or full ISO datetime with timezone.
    { t: 'поставь задаче 1 дедлайн на завтра', argsAnyOf: [{ taskIndex: 1, dueDate: { $regex: `^${D_TOMORROW}`, $flags: '' } }, { taskIndex: 1, dueDate: 'tomorrow' }] },
    { t: 'перенеси задачу 4 в Work', args: { taskIndex: 4, tag: 'Work' } },
    { t: 'обнови задачу 5 статус Done', args: { taskIndex: 5, status: 'Done' } },
  ];
  for (const u of updates) {
    addCase({
      userText: u.t,
      lastShownList,
      expected: {
        type: 'tool',
        toolName: 'notion.update_task',
        argsAnyOf: u.argsAnyOf ? u.argsAnyOf : [u.args],
        compare: u.args?.title ? { ignoreCasePaths: ['tool.args.title'] } : null,
      },
    });
  }
  // update with time
  addCase({
    userText: 'поставь задаче 1 дедлайн сегодня в 18:00',
    lastShownList,
    expected: { type: 'tool', toolName: 'notion.update_task', args: { taskIndex: 1, dueDate: { $regex: `^${D_TODAY}T18:00`, $flags: '' } } },
  });
  // more update fuzz
  for (let i = 1; i <= 24; i++) {
    const n = (i % 10) + 1;
    addCase({
      userText: `обнови задачу номер ${n} добавь описание: тест ${i}`,
      lastShownList,
      expected: { typeAnyOf: ['tool'], toolNameAnyOf: ['notion.append_description', 'notion.update_task'] },
    });
  }

  // 4) Done (20)
  for (let i = 1; i <= 10; i++) {
    addCase({
      userText: `пометь выполненной задачу ${i}`,
      lastShownList,
      expected: { type: 'tool', toolName: 'notion.mark_done', args: { taskIndex: i } },
    });
  }
  const doneByName = ['купи молоко', 'позвони маме', 'оплати интернет', 'сделай зарядку', 'разбери инбокс', 'напиши пост', 'подготовь созвон', 'купи билеты', 'обнови резюме', 'прочитай статью'];
  for (const t of doneByName) {
    addCase({
      userText: `отметь как done: ${t}`,
      expected: { typeAnyOf: ['tool'], toolNameAnyOf: ['notion.find_tasks', 'notion.mark_done'] },
    });
  }

  // 5) Delete (20)
  for (let i = 1; i <= 10; i++) {
    addCase({
      userText: `удали задачу ${i}`,
      lastShownList,
      expected: { type: 'tool', toolName: 'notion.move_to_deprecated', args: { taskIndex: i } },
    });
  }
  const delByName = ['купить молоко', 'позвонить маме', 'оплатить интернет', 'сделать зарядку', 'написать пост', 'подготовить созвон', 'разобрать inbox', 'купить билеты', 'обновить резюме', 'прочитать статью'];
  for (const t of delByName) {
    addCase({
      userText: `удали задачу "${t}"`,
      expected: { typeAnyOf: ['tool'], toolNameAnyOf: ['notion.find_tasks', 'notion.move_to_deprecated'] },
    });
  }

  // 6) Finder queries (10)
  const finds = ['молоко', 'билеты', 'созвон', 'резюме', 'статью', 'интернет', 'зарядку', 'пост', 'инбокс', 'маме'];
  for (const q of finds) {
    // Soft normalization: allow different cases and wordforms, only require the stem to appear.
    const stems = {
      молоко: 'молок',
      билеты: 'билет',
      созвон: 'созвон',
      резюме: 'резюм',
      статью: 'стат',
      интернет: 'интернет',
      зарядку: 'зарядк',
      пост: 'пост',
      инбокс: 'инбокс|inbox',
      маме: 'мам',
    };
    const stem = stems[q] || q;
    addCase({
      userText: `найди задачу про ${q}`,
      expected: { type: 'tool', toolName: 'notion.find_tasks', args: { queryText: { $regex: stem, $flags: 'i' } } },
    });
  }

  // 7) Ideas tags and updates (10)
  addCase({ userText: 'покажи идеи', expected: { type: 'tool', toolName: 'notion.list_ideas' } });
  addCase({ userText: 'добавь идею про новый контент план', expected: { type: 'tool', toolName: 'notion.create_idea' } });
  addCase({
    userText: 'в первой идее добавь тег dev',
    lastShownIdeasList,
    expected: { type: 'tool', toolName: 'notion.update_idea', argsAnyOf: [{ taskIndex: 1, tags: [{ $regex: '^dev$', $flags: 'i' }] }, { taskIndex: 1, tag: 'Dev' }] },
  });
  addCase({
    userText: 'во второй идее замени теги на work',
    lastShownIdeasList,
    expected: { type: 'tool', toolName: 'notion.update_idea', argsAnyOf: [{ taskIndex: 2, tags: ['Work'] }, { taskIndex: 2, tag: 'Work' }] },
  });
  for (let i = 0; i < 6; i++) {
    addCase({ userText: `обнови идею номер ${((i % 3) + 1)} статус на Concept`, lastShownIdeasList, expected: { type: 'tool', toolName: 'notion.update_idea' } });
  }

  // 8) Social schedule/list (5)
  addCase({ userText: 'покажи посты на эту неделю', expected: { type: 'tool', toolName: 'notion.list_social_posts' } });
  addCase({ userText: 'создай пост про запуск', expected: { type: 'tool', toolName: 'notion.create_social_post' } });
  addCase({ userText: 'обнови второй пост статус Published', lastShownSocialList, expected: { type: 'tool', toolName: 'notion.update_social_post' } });
  addCase({ userText: 'архивируй первый пост', lastShownSocialList, expected: { type: 'tool', toolName: 'notion.archive_social_post' } });
  addCase({ userText: 'покажи посты на завтра', expected: { type: 'tool', toolName: 'notion.list_social_posts' } });

  // 9) Journal (5)
  addCase({ userText: 'добавь запись в дневник: сегодня хороший день', expected: { type: 'tool', toolName: 'notion.create_journal_entry' } });
  addCase({ userText: 'покажи записи дневника за сегодня', expected: { type: 'tool', toolName: 'notion.list_journal_entries' } });
  addCase({ userText: 'обнови запись в дневнике, дополни: еще сделал спорт', expected: { type: 'tool', toolName: 'notion.update_journal_entry' } });
  addCase({ userText: 'удали запись в дневнике про спорт', expected: { type: 'tool', toolName: 'notion.archive_journal_entry' } });
  addCase({ userText: 'итог дня: доволен собой', expected: { type: 'tool', toolName: 'notion.create_journal_entry' } });

  // 10) A few noon cases (to exercise different nowIso)
  addCase({ userText: 'покажи задачи на сегодня', nowIso: nowNoonIso, expected: { type: 'tool', toolName: 'notion.list_tasks' } });
  addCase({ userText: 'добавь задачу купить молоко сегодня в 13:00', nowIso: nowNoonIso, expected: { type: 'tool', toolName: 'notion.create_task', args: { dueDate: { $regex: `^${D_TODAY}T13:00`, $flags: '' } } } });
  addCase({ userText: 'пометь выполненной задачу 2', nowIso: nowNoonIso, lastShownList, expected: { type: 'tool', toolName: 'notion.mark_done', args: { taskIndex: 2 } } });
  addCase({ userText: 'удали задачу 3', nowIso: nowNoonIso, lastShownList, expected: { type: 'tool', toolName: 'notion.move_to_deprecated', args: { taskIndex: 3 } } });
  addCase({ userText: 'покажи выполненные задачи', nowIso: nowNoonIso, expected: { type: 'tool', toolName: 'notion.list_tasks' } });

  // Ensure exactly 150 cases.
  // Pad with additional variations if needed.
  while (cases.length < 150) {
    const n = cases.length + 1;
    addCase({
      userText: `покажи задачи на сегодня, вариант ${n}`,
      expected: { type: 'tool', toolName: 'notion.list_tasks' },
    });
  }
  if (cases.length > 150) cases.length = 150;

  writeJsonl(outPath, cases);
  // eslint-disable-next-line no-console
  console.log(outPath);
  // eslint-disable-next-line no-console
  console.log(`cases=${cases.length}`);
}

main();


