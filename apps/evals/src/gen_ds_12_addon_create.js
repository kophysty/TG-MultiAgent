/**
 * Генератор addon create-heavy датасета
 *
 * Только кейсы которые должны приводить к create:
 * - Tasks (60)
 * - Ideas (50)
 * - Social (45)
 * - Journal (45)
 *
 * Для Mode B: 200 create * (1 create + 2-4 update + 1 trash) = ~800-1200 Notion операций
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

function seededPick(arr) {
  return arr[Math.floor(seededRandom() * arr.length)];
}

// ========== Данные для генерации ==========

const TASK_VERBS = ['добавь', 'создай', 'запиши', 'надо', 'новая задача:', 'задача:'];
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
  'Проверить баланс',
  'Написать пост',
  'Сделать backup',
  'Обновить зависимости',
  'Написать тесты',
  'Изучить новую технологию',
  'Подготовить демо',
  'Провести ретро',
  'Сделать деплой',
  'Проверить логи',
];

const IDEA_VERBS = ['добавь идею', 'создай идею', 'новая идея:', 'идея:', 'запиши идею'];
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
  'Группировка задач',
  'Подзадачи',
  'Комментарии к задачам',
  'Вложения файлов',
  'Совместная работа',
  'Уведомления по email',
  'Интеграция с GitHub',
  'Kanban доска',
  'Поиск по истории',
  'Архивирование проектов',
];

const SOCIAL_VERBS = ['создай пост', 'добавь пост', 'новый пост', 'пост:', 'запланируй пост'];
const SOCIAL_PLATFORMS = ['в телеграм', 'в фейсбук', 'в инстаграм', 'в linkedin', 'в twitter'];
const SOCIAL_TITLES = [
  'Анонс новой фичи',
  'Кейс использования',
  'Tips and tricks',
  'Behind the scenes',
  'Отзыв пользователя',
  'Roadmap на квартал',
  'Сравнение с конкурентами',
  'Tutorial для новичков',
  'FAQ по частым вопросам',
  'Релиз новой версии',
  'История создания',
  'Интервью с командой',
  'Инфографика',
  'Видео-обзор',
  'Чек-лист',
];

const JOURNAL_VERBS = ['запиши в дневник', 'дневник:', 'итог дня:', 'рефлексия:', 'добавь в дневник'];
const JOURNAL_TEXTS = [
  'Продуктивный день, закрыл много задач',
  'Тяжело далось утро',
  'Отличное настроение после тренировки',
  'Устал, но доволен результатами',
  'Созвоны весь день',
  'Спокойный день, читал книгу',
  'Стрессовая ситуация на работе',
  'День рождения друга',
  'Работал над сайд-проектом',
  'Медитировал утром',
  'Много кодил сегодня',
  'Провел важную встречу',
  'Решил сложную проблему',
  'Отдохнул и перезагрузился',
  'Планировал следующую неделю',
];

const CATEGORIES = ['Work', 'Home', 'Personal', 'Inbox'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const DATES = ['на сегодня', 'на завтра', 'на послезавтра', 'на понедельник', 'на 15-е', 'на следующую неделю'];

// ========== Генераторы ==========

function genTasksCreate(defaults) {
  const cases = [];
  const titles = seededShuffle(TASK_TITLES);

  for (let i = 0; i < 60; i++) {
    const title = titles[i % titles.length];
    const verb = seededPick(TASK_VERBS);
    const cat = seededRandom() > 0.5 ? seededPick(CATEGORIES) : null;
    const pr = seededRandom() > 0.6 ? seededPick(PRIORITIES) : null;
    const dd = seededRandom() > 0.4 ? seededPick(DATES) : null;

    let text = `${verb} ${title}`;
    if (cat) text += ` в ${cat}`;
    if (pr) text += ` приоритет ${pr}`;
    if (dd) text += ` ${dd}`;

    cases.push({
      id: `addon_task_${i + 1}`,
      userText: text,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_task' },
    });
  }

  return cases;
}

function genIdeasCreate(defaults) {
  const cases = [];
  const titles = seededShuffle(IDEA_TITLES);
  const areas = ['Dev', 'Product', 'Content', 'UX'];
  const tags = ['Feature', 'Improvement', 'Research', 'Bug'];

  for (let i = 0; i < 50; i++) {
    const title = titles[i % titles.length];
    const verb = seededPick(IDEA_VERBS);
    const area = seededRandom() > 0.5 ? seededPick(areas) : null;
    const tag = seededRandom() > 0.6 ? seededPick(tags) : null;

    let text = `${verb} ${title}`;
    if (area) text += ` в раздел ${area}`;
    if (tag) text += ` тег ${tag}`;

    cases.push({
      id: `addon_idea_${i + 1}`,
      userText: text,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_idea' },
    });
  }

  return cases;
}

function genSocialCreate(defaults) {
  const cases = [];
  const titles = seededShuffle(SOCIAL_TITLES);

  for (let i = 0; i < 45; i++) {
    const title = titles[i % titles.length];
    const verb = seededPick(SOCIAL_VERBS);
    const platform = seededPick(SOCIAL_PLATFORMS);
    const dd = seededRandom() > 0.4 ? seededPick(DATES) : null;

    let text = `${verb} ${platform}: ${title}`;
    if (dd) text += ` ${dd}`;

    cases.push({
      id: `addon_social_${i + 1}`,
      userText: text,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_social_post' },
    });
  }

  return cases;
}

function genJournalCreate(defaults) {
  const cases = [];
  const texts = seededShuffle(JOURNAL_TEXTS);
  const moods = [1, 2, 3, 4, 5];
  const types = ['Итог дня', 'Рефлексия', 'Благодарность', 'Планы'];

  for (let i = 0; i < 45; i++) {
    const journalText = texts[i % texts.length];
    const verb = seededPick(JOURNAL_VERBS);
    const mood = seededRandom() > 0.5 ? seededPick(moods) : null;
    const type = seededRandom() > 0.7 ? seededPick(types) : null;

    let text = `${verb} ${journalText}`;
    if (mood) text += `, настроение ${mood}`;
    if (type) text += `, тип ${type}`;

    cases.push({
      id: `addon_journal_${i + 1}`,
      userText: text,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: 'notion.create_journal_entry' },
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

  // Tasks (60)
  allCases.push(...genTasksCreate(defaults));

  // Ideas (50)
  allCases.push(...genIdeasCreate(defaults));

  // Social (45)
  allCases.push(...genSocialCreate(defaults));

  // Journal (45)
  allCases.push(...genJournalCreate(defaults));

  // Ensure exactly 200
  while (allCases.length < 200) {
    allCases.push({
      id: `addon_pad_${allCases.length}`,
      userText: `добавь задачу тест ${allCases.length}`,
      tz,
      nowIso,
      expected: { type: 'tool', toolName: 'notion.create_task' },
    });
  }
  if (allCases.length > 200) {
    allCases.length = 200;
  }

  const outPath = path.join(repoRoot, 'apps', 'evals', 'ds', '13_2026-01-13_addon_create_200.jsonl');
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
