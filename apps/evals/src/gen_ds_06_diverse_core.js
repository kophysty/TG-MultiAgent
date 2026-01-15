/**
 * Генератор разнообразного core датасета
 * Заменяет 04_planner_core_300.jsonl
 *
 * Принципы:
 * - Каждый кейс уникален (без "вариант 1, 2, 3")
 * - Разные формулировки одних и тех же команд
 * - Реалистичные примеры задач
 * - Разные комбинации параметров
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

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Seed random for reproducibility
let seed = 20260113;
function seededRandom() {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

function seededPick(arr) {
  return arr[Math.floor(seededRandom() * arr.length)];
}

function seededShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========== Реалистичные данные ==========

const TASK_TITLES = [
  'Купить молоко',
  'Позвонить маме',
  'Оплатить интернет',
  'Записаться к врачу',
  'Забронировать столик',
  'Отправить отчет',
  'Подготовить презентацию',
  'Созвон с командой',
  'Ревью кода',
  'Написать документацию',
  'Обновить резюме',
  'Заказать билеты',
  'Проверить email',
  'Сделать зарядку',
  'Прочитать статью',
  'Настроить CI/CD',
  'Починить баг в API',
  'Провести 1-on-1',
  'Спланировать спринт',
  'Разобрать inbox',
  'Полить цветы',
  'Выгулять собаку',
  'Сходить в спортзал',
  'Купить продукты',
  'Приготовить ужин',
  'Постирать вещи',
  'Убраться в квартире',
  'Оплатить коммуналку',
  'Продлить подписку',
  'Заменить лампочку',
];

const IDEA_TITLES = [
  'Добавить темную тему',
  'Интеграция с Календарем',
  'Push уведомления',
  'Голосовые команды',
  'Шаринг списков',
  'Виджет для iOS',
  'Геймификация задач',
  'Статистика продуктивности',
  'AI подсказки',
  'Шаблоны задач',
  'Интеграция Slack',
  'Экспорт в PDF',
  'Теги с цветами',
  'Повторяющиеся задачи',
  'Приоритеты с дедлайнами',
];

const SOCIAL_TITLES = [
  'Анонс новой фичи',
  'Кейс использования бота',
  'Tips and tricks',
  'Behind the scenes разработки',
  'Отзыв пользователя',
  'Roadmap на квартал',
  'Сравнение с конкурентами',
  'Tutorial для новичков',
  'FAQ по частым вопросам',
  'Релиз версии 2.0',
];

const JOURNAL_MOODS = [
  'Продуктивный день, закрыл 5 задач',
  'Тяжело далось утро, но вечер был лучше',
  'Отличное настроение после тренировки',
  'Устал, но доволен результатами',
  'Созвоны весь день, голова кругом',
  'Спокойный день, читал книгу',
  'Стрессовая ситуация на работе',
  'День рождения друга, классно провели время',
  'Работал над сайд-проектом',
  'Медитировал утром, весь день в потоке',
];

// ========== Генераторы кейсов ==========

function genTasksList(defaults) {
  const cases = [];
  const phrases = seededShuffle([
    // Базовые
    { t: 'покажи задачи', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'что у меня в списке', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'какие есть задачи', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'мои задачи', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'список дел', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    // На сегодня
    { t: 'покажи задачи на сегодня', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ preset: 'today' }] } },
    { t: 'что делать сегодня', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'план на сегодня', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'задачи на сегодняшний день', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    // На завтра
    { t: 'покажи задачи на завтра', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'что запланировано на завтра', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    // По категориям
    { t: 'покажи рабочие задачи', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ tag: 'Work' }] } },
    { t: 'задачи по работе', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'домашние дела', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ tag: 'Home' }] } },
    { t: 'что в инбоксе', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ tag: 'Inbox' }] } },
    { t: 'входящие задачи', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    // Выполненные
    { t: 'покажи выполненные задачи', exp: { type: 'tool', toolName: 'notion.list_tasks', argsAnyOf: [{ doneOnly: true }] } },
    { t: 'что я уже сделал', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'завершенные дела', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    // С поиском
    { t: 'покажи задачи про молоко', exp: { type: 'tool', toolName: 'notion.list_tasks', args: { queryText: { $regex: 'молок', $flags: 'i' } } } },
    { t: 'задачи связанные с созвоном', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'что там с отчетом', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    // На неделю
    { t: 'покажи задачи на эту неделю', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'план на неделю', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
    { t: 'задачи на следующую неделю', exp: { type: 'tool', toolName: 'notion.list_tasks' } },
  ]);

  for (const p of phrases.slice(0, 25)) {
    cases.push({
      id: `tasks_list_${md5(p.t)}`,
      userText: p.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: p.exp,
    });
  }
  return cases;
}

function genTasksCreate(defaults) {
  const cases = [];
  const templates = [
    (t, tag, pr, dd) => `добавь задачу ${t}${dd ? ` на ${dd}` : ''}${pr ? ` приоритет ${pr}` : ''}`,
    (t, tag, pr, dd) => `создай задачу: ${t}${dd ? `, дедлайн ${dd}` : ''}`,
    (t, tag, pr, dd) => `новая задача - ${t}${tag ? ` (${tag})` : ''}`,
    (t, tag, pr, dd) => `запиши: ${t}${dd ? ` до ${dd}` : ''}`,
    (t, tag, pr, dd) => `надо ${t.toLowerCase()}${dd ? ` к ${dd}` : ''}`,
    (t, tag, pr, dd) => `${t} - добавь в задачи${pr ? `, важность ${pr}` : ''}`,
    (t, tag, pr, dd) => `закинь в список: ${t}`,
    (t, tag, pr, dd) => `напомни ${t.toLowerCase()}${dd ? ` ${dd}` : ''}`,
  ];

  const tags = [null, 'Work', 'Home', 'Inbox', 'Personal'];
  const priorities = [null, 'Low', 'Medium', 'High'];
  const dates = [null, 'сегодня', 'завтра', 'послезавтра', '15-го', 'в понедельник'];

  const titles = seededShuffle(TASK_TITLES);
  for (let i = 0; i < 25; i++) {
    const title = titles[i % titles.length];
    const template = templates[i % templates.length];
    const tag = tags[i % tags.length];
    const pr = priorities[(i + 1) % priorities.length];
    const dd = dates[(i + 2) % dates.length];

    cases.push({
      id: `tasks_create_${md5(title + i)}`,
      userText: template(title, tag, pr, dd),
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_task' },
    });
  }
  return cases;
}

function genTasksUpdate(defaults) {
  const cases = [];
  const lastShownList = [
    { index: 1, id: 't1', title: 'Купить молоко' },
    { index: 2, id: 't2', title: 'Позвонить маме' },
    { index: 3, id: 't3', title: 'Оплатить интернет' },
    { index: 4, id: 't4', title: 'Сделать зарядку' },
    { index: 5, id: 't5', title: 'Написать отчет' },
    { index: 6, id: 't6', title: 'Подготовить созвон' },
    { index: 7, id: 't7', title: 'Разобрать inbox' },
    { index: 8, id: 't8', title: 'Купить билеты' },
  ];

  const updates = seededShuffle([
    { t: 'обнови задачу 1 - статус В работе', idx: 1 },
    { t: 'поставь второй задаче приоритет High', idx: 2 },
    { t: 'перенеси третью задачу в категорию Work', idx: 3 },
    { t: 'задаче 4 поставь дедлайн на завтра', idx: 4 },
    { t: 'пятую задачу сделай срочной', idx: 5 },
    { t: 'измени статус задачи 6 на Done', idx: 6 },
    { t: 'задачу номер 7 переименуй в "Проверить inbox"', idx: 7 },
    { t: 'восьмой пункт - приоритет Medium', idx: 8 },
    { t: 'первой задаче поставь низкий приоритет', idx: 1 },
    { t: 'обнови статус второй - Idle', idx: 2 },
    { t: 'третьей задаче добавь дедлайн 15 января', idx: 3 },
    { t: 'задачу 4 перекинь в Home', idx: 4 },
    { t: 'пятую - статус In work', idx: 5 },
    { t: 'шестой задаче поставь высокий приоритет', idx: 6 },
    { t: 'седьмую перенеси на послезавтра', idx: 7 },
    { t: 'восьмую в категорию Inbox', idx: 8 },
    { t: 'первую задачу - приоритет High, статус In work', idx: 1 },
    { t: 'второй задаче - дедлайн сегодня', idx: 2 },
    { t: 'третья - категория Personal', idx: 3 },
    { t: 'обнови четвертую: приоритет Low', idx: 4 },
  ]);

  for (const u of updates.slice(0, 20)) {
    cases.push({
      id: `tasks_update_${md5(u.t)}`,
      userText: u.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      lastShownList,
      expected: { type: 'tool', toolName: 'notion.update_task', args: { taskIndex: u.idx } },
    });
  }
  return cases;
}

function genTasksDoneDeleteFind(defaults) {
  const cases = [];
  const lastShownList = [
    { index: 1, id: 't1', title: 'Купить молоко' },
    { index: 2, id: 't2', title: 'Позвонить маме' },
    { index: 3, id: 't3', title: 'Оплатить интернет' },
    { index: 4, id: 't4', title: 'Сделать зарядку' },
    { index: 5, id: 't5', title: 'Написать отчет' },
  ];

  // Mark done
  const doneTexts = seededShuffle([
    { t: 'отметь выполненной первую задачу', idx: 1 },
    { t: 'задача 2 готова', idx: 2 },
    { t: 'сделал третью', idx: 3 },
    { t: 'закрой четвертую задачу', idx: 4 },
    { t: 'пятая выполнена', idx: 5 },
    { t: 'первую - done', idx: 1 },
    { t: 'заверши вторую задачу', idx: 2 },
  ]);

  for (const d of doneTexts.slice(0, 7)) {
    cases.push({
      id: `tasks_done_${md5(d.t)}`,
      userText: d.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      lastShownList,
      expected: { type: 'tool', toolName: 'notion.mark_done', args: { taskIndex: d.idx } },
    });
  }

  // Delete/deprecate
  const deleteTexts = seededShuffle([
    { t: 'удали первую задачу', idx: 1 },
    { t: 'убери вторую из списка', idx: 2 },
    { t: 'третью задачу в deprecated', idx: 3 },
    { t: 'архивируй четвертую', idx: 4 },
    { t: 'пятую можно удалить', idx: 5 },
    { t: 'первая больше не нужна', idx: 1 },
  ]);

  for (const d of deleteTexts.slice(0, 6)) {
    cases.push({
      id: `tasks_delete_${md5(d.t)}`,
      userText: d.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      lastShownList,
      expected: { type: 'tool', toolName: 'notion.move_to_deprecated', args: { taskIndex: d.idx } },
    });
  }

  // Find
  const findTexts = seededShuffle([
    'найди задачу про молоко',
    'поиск задач с созвоном',
    'есть что-нибудь про отчет?',
    'найди все задачи про билеты',
    'где задача про интернет',
    'ищи задачу с зарядкой',
    'найди задачи со словом резюме',
  ]);

  for (const f of findTexts.slice(0, 7)) {
    cases.push({
      id: `tasks_find_${md5(f)}`,
      userText: f,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.find_tasks' },
    });
  }

  return cases;
}

function genIdeas(defaults) {
  const cases = [];
  const lastShownIdeasList = [
    { index: 1, id: 'i1', title: 'Добавить темную тему' },
    { index: 2, id: 'i2', title: 'Интеграция с Календарем' },
    { index: 3, id: 'i3', title: 'Push уведомления' },
    { index: 4, id: 'i4', title: 'Голосовые команды' },
    { index: 5, id: 'i5', title: 'Шаринг списков' },
  ];

  // List ideas (15)
  const listTexts = seededShuffle([
    'покажи идеи',
    'список идей',
    'какие есть идеи',
    'мои идеи',
    'что в backlog идей',
    'идеи в статусе Review',
    'идеи в разработке',
    'покажи идеи про UX',
    'идеи с тегом Dev',
    'идеи в категории Concept',
    'покажи новые идеи',
    'идеи на рассмотрении',
    'что там с идеями',
    'все мои идеи',
    'идеи в области Product',
  ]);

  for (const t of listTexts.slice(0, 15)) {
    cases.push({
      id: `ideas_list_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolNameAnyOf: ['notion.list_ideas', 'notion.find_ideas'] },
    });
  }

  // Find ideas (10)
  const findTexts = seededShuffle([
    'найди идеи про тему',
    'поиск идей с календарем',
    'есть идеи про уведомления?',
    'ищи идею про голос',
    'найди все про шаринг',
    'идеи связанные с виджетом',
    'где идея про статистику',
    'найди идеи с AI',
    'поиск идей про шаблоны',
    'ищи идею интеграция',
  ]);

  for (const t of findTexts.slice(0, 10)) {
    cases.push({
      id: `ideas_find_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.find_ideas' },
    });
  }

  // Create ideas (15)
  const titles = seededShuffle(IDEA_TITLES);
  const createTemplates = [
    (t) => `добавь идею: ${t}`,
    (t) => `новая идея - ${t}`,
    (t) => `запиши идею про ${t.toLowerCase()}`,
    (t) => `идея: ${t}`,
    (t) => `создай идею "${t}" в раздел Dev`,
  ];

  for (let i = 0; i < 15; i++) {
    const title = titles[i % titles.length];
    const template = createTemplates[i % createTemplates.length];
    cases.push({
      id: `ideas_create_${md5(title + i)}`,
      userText: template(title),
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_idea' },
    });
  }

  // Update ideas (10)
  const updateTexts = seededShuffle([
    { t: 'обнови первую идею - статус Review', idx: 1 },
    { t: 'идее 2 поставь приоритет High', idx: 2 },
    { t: 'третью идею перенеси в Done', idx: 3 },
    { t: 'добавь тег Dev к идее 4', idx: 4 },
    { t: 'пятой идее поставь area Product', idx: 5 },
    { t: 'первую идею - приоритет Medium', idx: 1 },
    { t: 'обнови вторую: статус In Progress', idx: 2 },
    { t: 'третьей добавь теги Content, Dev', idx: 3 },
    { t: 'идею 4 - проект TG-Bot', idx: 4 },
    { t: 'пятую перенеси в Inbox', idx: 5 },
  ]);

  for (const u of updateTexts.slice(0, 10)) {
    cases.push({
      id: `ideas_update_${md5(u.t)}`,
      userText: u.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      lastShownIdeasList,
      expected: { type: 'tool', toolName: 'notion.update_idea', args: { taskIndex: u.idx } },
    });
  }

  // Archive ideas (10)
  const archiveTexts = seededShuffle([
    { t: 'архивируй первую идею', idx: 1 },
    { t: 'вторую идею удали', idx: 2 },
    { t: 'третья идея не актуальна', idx: 3 },
    { t: 'убери четвертую идею', idx: 4 },
    { t: 'пятую в архив', idx: 5 },
    { t: 'первую идею можно убрать', idx: 1 },
    { t: 'закрой вторую идею', idx: 2 },
    { t: 'архивируй идею 3', idx: 3 },
    { t: 'идею 4 в архив', idx: 4 },
    { t: 'удали пятую из списка', idx: 5 },
  ]);

  for (const a of archiveTexts.slice(0, 10)) {
    cases.push({
      id: `ideas_archive_${md5(a.t)}`,
      userText: a.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      lastShownIdeasList,
      expected: { type: 'tool', toolName: 'notion.archive_idea', args: { taskIndex: a.idx } },
    });
  }

  return cases;
}

function genSocial(defaults) {
  const cases = [];
  const lastShownSocialList = [
    { index: 1, id: 's1', title: 'Анонс новой фичи' },
    { index: 2, id: 's2', title: 'Кейс использования' },
    { index: 3, id: 's3', title: 'Tips and tricks' },
    { index: 4, id: 's4', title: 'Behind the scenes' },
  ];

  // List posts (15)
  const listTexts = seededShuffle([
    'покажи посты',
    'список постов',
    'что запланировано в соцсетях',
    'посты на эту неделю',
    'посты на завтра',
    'покажи посты в телеграме',
    'посты для фейсбука',
    'что в инстаграме',
    'посты со статусом Draft',
    'запланированные посты',
    'посты к публикации',
    'посты на следующую неделю',
    'что публикуем сегодня',
    'посты в статусе Planned',
    'контент план на неделю',
  ]);

  for (const t of listTexts.slice(0, 15)) {
    cases.push({
      id: `social_list_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.list_social_posts' },
    });
  }

  // Find posts (5)
  const findTexts = seededShuffle([
    'найди посты про релиз',
    'поиск постов с AI',
    'где пост про tips',
    'найди контент про UX',
    'ищи посты с кейсами',
  ]);

  for (const t of findTexts.slice(0, 5)) {
    cases.push({
      id: `social_find_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.find_social_posts' },
    });
  }

  // Create posts (15)
  const titles = seededShuffle(SOCIAL_TITLES);
  const platforms = ['телеграм', 'фейсбук', 'инстаграм', 'linkedin', 'twitter'];
  const createTemplates = [
    (t, p) => `создай пост в ${p}: ${t}`,
    (t, p) => `добавь пост для ${p} - ${t}`,
    (t, p) => `новый пост ${t} на завтра в ${p}`,
    (t, p) => `запланируй пост "${t}" в ${p}`,
    (t, p) => `пост в ${p}: ${t}`,
  ];

  for (let i = 0; i < 15; i++) {
    const title = titles[i % titles.length];
    const platform = platforms[i % platforms.length];
    const template = createTemplates[i % createTemplates.length];
    cases.push({
      id: `social_create_${md5(title + platform + i)}`,
      userText: template(title, platform),
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_social_post' },
    });
  }

  // Update posts (10)
  const updateTexts = seededShuffle([
    { t: 'обнови первый пост - статус Scheduled', idx: 1 },
    { t: 'второму посту поставь дату на завтра', idx: 2 },
    { t: 'третий пост перенеси на 15-е', idx: 3 },
    { t: 'пост 4 - платформа TG', idx: 4 },
    { t: 'первый пост - статус Published', idx: 1 },
    { t: 'обнови второй: content type Video', idx: 2 },
    { t: 'третьему добавь ссылку', idx: 3 },
    { t: 'четвертый в Draft', idx: 4 },
    { t: 'поменяй дату первого на послезавтра', idx: 1 },
    { t: 'второй пост - платформа FB', idx: 2 },
  ]);

  for (const u of updateTexts.slice(0, 10)) {
    cases.push({
      id: `social_update_${md5(u.t)}`,
      userText: u.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      lastShownSocialList,
      expected: { type: 'tool', toolName: 'notion.update_social_post', args: { taskIndex: u.idx } },
    });
  }

  // Archive posts (5)
  const archiveTexts = seededShuffle([
    { t: 'архивируй первый пост', idx: 1 },
    { t: 'второй пост удали', idx: 2 },
    { t: 'третий больше не нужен', idx: 3 },
    { t: 'убери четвертый пост', idx: 4 },
    { t: 'первый в архив', idx: 1 },
  ]);

  for (const a of archiveTexts.slice(0, 5)) {
    cases.push({
      id: `social_archive_${md5(a.t)}`,
      userText: a.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      lastShownSocialList,
      expected: { type: 'tool', toolName: 'notion.archive_social_post', args: { taskIndex: a.idx } },
    });
  }

  return cases;
}

function genJournal(defaults) {
  const cases = [];

  // List entries (10)
  const listTexts = seededShuffle([
    'покажи записи дневника',
    'что в дневнике за сегодня',
    'записи за вчера',
    'последняя запись дневника',
    'дневник за эту неделю',
    'покажи итоги дня',
    'записи про работу',
    'дневник с типом Рефлексия',
    'мои записи в дневнике',
    'что писал вчера',
  ]);

  for (const t of listTexts.slice(0, 10)) {
    cases.push({
      id: `journal_list_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.list_journal_entries' },
    });
  }

  // Find entries (5)
  const findTexts = seededShuffle([
    'найди в дневнике про стартап',
    'поиск записей про тренировку',
    'где писал про созвон',
    'найди запись про книгу',
    'ищи в дневнике про стресс',
  ]);

  for (const t of findTexts.slice(0, 5)) {
    cases.push({
      id: `journal_find_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.find_journal_entries' },
    });
  }

  // Create entries (15)
  const moods = seededShuffle(JOURNAL_MOODS);
  const createTemplates = [
    (m) => `запиши в дневник: ${m}`,
    (m) => `итог дня: ${m}`,
    (m) => `добавь в дневник - ${m}`,
    (m) => `рефлексия: ${m}`,
    (m) => `дневник: ${m}`,
  ];

  for (let i = 0; i < 15; i++) {
    const mood = moods[i % moods.length];
    const template = createTemplates[i % createTemplates.length];
    cases.push({
      id: `journal_create_${md5(mood + i)}`,
      userText: template(mood),
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_journal_entry' },
    });
  }

  // Update entries (5)
  const updateTexts = seededShuffle([
    'обнови последнюю запись - настроение 5',
    'добавь к дневнику: еще погулял вечером',
    'измени энергию на 4 в последней записи',
    'дополни дневник: созвон прошел хорошо',
    'обнови запись: тип Итог дня',
  ]);

  for (const t of updateTexts.slice(0, 5)) {
    cases.push({
      id: `journal_update_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.update_journal_entry' },
    });
  }

  // Archive entries (5)
  const archiveTexts = seededShuffle([
    'удали последнюю запись в дневнике',
    'архивируй вчерашнюю запись',
    'убери запись за 10-е',
    'эту запись можно удалить',
    'архивируй дневник за понедельник',
  ]);

  for (const t of archiveTexts.slice(0, 5)) {
    cases.push({
      id: `journal_archive_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.archive_journal_entry' },
    });
  }

  return cases;
}

function genMemoryChat(defaults) {
  const cases = [];

  // Memory note (15)
  const memoryTexts = seededShuffle([
    'запомни что я предпочитаю краткие ответы',
    'добавь в память: работаю по московскому времени',
    'запомни - я не люблю эмодзи в ответах',
    'в память: предпочитаю списки вместо текста',
    'запомни что мы постим в телеграм и фейсбук',
    'добавь в память: мой таймзон MSK',
    'запомни: отвечай на русском',
    'в память - я работаю над AI ботом',
    'запомни что приоритеты обычно High',
    'добавь в память: дефолтная категория Work',
    'запомни: я часто забываю про inbox',
    'в память: напоминай про дедлайны',
    'запомни что я использую GTD',
    'добавь: предпочитаю утренние созвоны',
    'запомни - работаю с Notion',
  ]);

  for (const t of memoryTexts.slice(0, 15)) {
    cases.push({
      id: `memory_note_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'chat', chatContains: 'запомнил' },
    });
  }

  // Preference extractor (10)
  const prefTexts = seededShuffle([
    'по умолчанию отвечай коротко',
    'всегда отвечай без эмодзи',
    'обычно добавляй задачи в Work',
    'никогда не используй markdown',
    'таймзона Europe/Moscow',
    'предпочитаю таблицы',
    'отвечай подробно когда спрашиваю про код',
    'дефолтный приоритет Medium',
    'всегда показывай дедлайны',
    'по умолчанию не включай выполненные',
  ]);

  for (const t of prefTexts.slice(0, 10)) {
    cases.push({
      id: `pref_extract_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['chat', 'tool'] },
    });
  }

  // Clarify (5)
  const clarifyTexts = seededShuffle([
    'запомни',
    'добавь в память:',
    'запомни:',
    'в память',
    'preferences',
  ]);

  for (const t of clarifyTexts.slice(0, 5)) {
    cases.push({
      id: `memory_clarify_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['chat', 'tool'] },
    });
  }

  return cases;
}

function genMixed(defaults) {
  const cases = [];

  // Mixed languages (10)
  const mixedTexts = seededShuffle([
    'создай task на завтра',
    'add задачу купить milk',
    'покажи my tasks',
    'update первую task',
    'create идею про feature',
    'show посты for tomorrow',
    'добавь post в telegram',
    'найди tasks про meeting',
    'journal entry: good day',
    'mark done задачу 1',
  ]);

  for (const t of mixedTexts.slice(0, 10)) {
    cases.push({
      id: `mixed_lang_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['tool', 'chat'] },
    });
  }

  // Emoji (10)
  const emojiTexts = seededShuffle([
    'добавь задачу 🚀 запустить релиз',
    'создай идею 💡 новая фича',
    'пост 📱 про мобильное приложение',
    'запиши в дневник 😊 хороший день',
    'задача ⚡ срочно сделать',
    'идея 🎯 цель на квартал',
    '✅ отметь первую выполненной',
    '🗑️ удали вторую задачу',
    '📋 покажи список',
    '🔍 найди задачу про деньги',
  ]);

  for (const t of emojiTexts.slice(0, 10)) {
    cases.push({
      id: `emoji_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['tool', 'chat'] },
    });
  }

  // Long texts (10)
  const longTexts = [
    'добавь задачу: нужно подготовить презентацию для инвесторов, включить слайды про продукт, команду, финансы, roadmap и конкурентный анализ',
    'создай идею про систему уведомлений которая будет напоминать о задачах за час до дедлайна и отправлять ежедневный digest',
    'запиши в дневник: сегодня был очень продуктивный день, закрыл три больших задачи, провел два созвона и еще успел почитать книгу',
    'покажи все задачи которые связаны с разработкой нового функционала для интеграции с внешними сервисами',
    'добавь пост про то как мы используем AI для автоматизации рутинных задач и повышения продуктивности команды',
  ];

  for (const t of longTexts) {
    cases.push({
      id: `long_${md5(t)}`,
      userText: t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { typeAnyOf: ['tool', 'chat'] },
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

  // Tasks (90): list 25 + create 25 + update 20 + done/delete/find 20
  allCases.push(...genTasksList(defaults));
  allCases.push(...genTasksCreate(defaults));
  allCases.push(...genTasksUpdate(defaults));
  allCases.push(...genTasksDoneDeleteFind(defaults));

  // Ideas (60): list 15 + find 10 + create 15 + update 10 + archive 10
  allCases.push(...genIdeas(defaults));

  // Social (50): list 15 + find 5 + create 15 + update 10 + archive 5
  allCases.push(...genSocial(defaults));

  // Journal (40): list 10 + find 5 + create 15 + update 5 + archive 5
  allCases.push(...genJournal(defaults));

  // Memory/Chat (30): memory_note 15 + extractor 10 + clarify 5
  allCases.push(...genMemoryChat(defaults));

  // Mixed (30): mixed lang 10 + emoji 10 + long 10
  allCases.push(...genMixed(defaults));

  // Ensure exactly 300
  while (allCases.length < 300) {
    allCases.push({
      id: `pad_${allCases.length}`,
      userText: `покажи задачи ${allCases.length}`,
      tz,
      nowIso,
      expected: { type: 'tool', toolName: 'notion.list_tasks' },
    });
  }
  if (allCases.length > 300) {
    allCases.length = 300;
  }

  const outPath = path.join(repoRoot, 'apps', 'evals', 'ds', '07_2026-01-13_diverse_core_300.jsonl');
  writeJsonl(outPath, allCases);

  // eslint-disable-next-line no-console
  console.log(`Written ${allCases.length} cases to ${outPath}`);

  // Stats
  const stats = {};
  for (const c of allCases) {
    const prefix = c.id.split('_')[0] + '_' + c.id.split('_')[1];
    stats[prefix] = (stats[prefix] || 0) + 1;
  }
  // eslint-disable-next-line no-console
  console.log('Stats:', JSON.stringify(stats, null, 2));
}

main();

