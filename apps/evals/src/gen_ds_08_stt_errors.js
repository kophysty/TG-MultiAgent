/**
 * Генератор датасета с типичными ошибками STT (speech-to-text)
 *
 * Категории:
 * - Склеенные слова (25)
 * - Опечатки в ключевых словах (25)
 * - Лишние слова-паразиты (20)
 * - Пропущенные пробелы (15)
 * - Неправильная раскладка (15)
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

const lastShownList = [
  { index: 1, id: 't1', title: 'Купить молоко' },
  { index: 2, id: 't2', title: 'Позвонить маме' },
  { index: 3, id: 't3', title: 'Оплатить интернет' },
  { index: 4, id: 't4', title: 'Сделать зарядку' },
  { index: 5, id: 't5', title: 'Написать отчет' },
];

// ========== Генераторы категорий ==========

function genGluedWords(defaults) {
  const cases = [];

  // Склеенные слова - типичная ошибка STT когда пробелы не распознаются
  const glued = seededShuffle([
    // Полностью склеенные команды
    { t: 'покажизадачи', expect: 'notion.list_tasks' },
    { t: 'покажизадачинасегодня', expect: 'notion.list_tasks' },
    { t: 'добавьзадачукупитьмолоко', expect: 'notion.create_task' },
    { t: 'создайзадачупозвонитьмаме', expect: 'notion.create_task' },
    { t: 'удализадачупервую', expect: 'notion.move_to_deprecated' },
    { t: 'отметьвыполненнойзадачу', expect: 'notion.mark_done' },
    { t: 'обновизадачуодин', expect: 'notion.update_task' },
    { t: 'покажиидеи', expect: 'notion.list_ideas' },
    { t: 'создайидеюпротемнуютему', expect: 'notion.create_idea' },
    { t: 'покажипосты', expect: 'notion.list_social_posts' },
    { t: 'создайпоствтелеграм', expect: 'notion.create_social_post' },
    { t: 'запишивдневник', expect: 'notion.create_journal_entry' },
    // Частично склеенные
    { t: 'покажи задачина сегодня', expect: 'notion.list_tasks' },
    { t: 'добавь задачукупить молоко', expect: 'notion.create_task' },
    { t: 'создай задачу позвонитьмаме', expect: 'notion.create_task' },
    { t: 'удали первуюзадачу', expect: 'notion.move_to_deprecated' },
    { t: 'отметь выполненнойпервую', expect: 'notion.mark_done' },
    { t: 'обновистатус задачи', expect: 'notion.update_task' },
    { t: 'покажи идеина тему', expect: 'notion.list_ideas' },
    { t: 'создай идеюпро интеграцию', expect: 'notion.create_idea' },
    { t: 'покажи постына завтра', expect: 'notion.list_social_posts' },
    { t: 'создай поств телеграм', expect: 'notion.create_social_post' },
    { t: 'запиши вдневник итоги дня', expect: 'notion.create_journal_entry' },
    { t: 'запомничто я работаю', expect: null }, // memory note
    { t: 'добавьвпамять настройку', expect: null },
  ]);

  for (const item of glued.slice(0, 25)) {
    const c = {
      id: `stt_glued_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: item.expect
        ? { type: 'tool', toolName: item.expect }
        : { typeAnyOf: ['tool', 'chat'] },
    };
    if (item.t.includes('первую') || item.t.includes('один')) {
      c.lastShownList = lastShownList;
    }
    cases.push(c);
  }

  return cases;
}

function genTypos(defaults) {
  const cases = [];

  // Опечатки в ключевых словах
  const typos = seededShuffle([
    // Опечатки в глаголах
    { t: 'пакажи задачи', expect: 'notion.list_tasks' },
    { t: 'покожи задачи', expect: 'notion.list_tasks' },
    { t: 'покозы задачи', expect: 'notion.list_tasks' },
    { t: 'покжаи задачи', expect: 'notion.list_tasks' },
    { t: 'дабавь задачу', expect: 'notion.create_task' },
    { t: 'добаьв задачу', expect: 'notion.create_task' },
    { t: 'дабав задачу', expect: 'notion.create_task' },
    { t: 'создай задачу', expect: 'notion.create_task' }, // correct for reference
    { t: 'сздай задачу', expect: 'notion.create_task' },
    { t: 'созад задачу', expect: 'notion.create_task' },
    { t: 'удоли задачу', expect: 'notion.move_to_deprecated' },
    { t: 'удалить задачу', expect: 'notion.move_to_deprecated' },
    { t: 'удоали задачу', expect: 'notion.move_to_deprecated' },
    { t: 'обноыи задачу', expect: 'notion.update_task' },
    { t: 'абнови задачу', expect: 'notion.update_task' },
    { t: 'отмеьт выполненной', expect: 'notion.mark_done' },
    { t: 'атметь выполненной', expect: 'notion.mark_done' },
    // Опечатки в существительных
    { t: 'покажи задчи', expect: 'notion.list_tasks' },
    { t: 'покажи заадчи', expect: 'notion.list_tasks' },
    { t: 'покажи зачади', expect: 'notion.list_tasks' },
    { t: 'добавь задчу', expect: 'notion.create_task' },
    { t: 'добавь здачу', expect: 'notion.create_task' },
    { t: 'покажи идеь', expect: 'notion.list_ideas' },
    { t: 'покажи идеии', expect: 'notion.list_ideas' },
    { t: 'покажи постыы', expect: 'notion.list_social_posts' },
  ]);

  for (const item of typos.slice(0, 25)) {
    cases.push({
      id: `stt_typo_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: item.expect },
    });
  }

  return cases;
}

function genFillerWords(defaults) {
  const cases = [];

  // Слова-паразиты которые часто вставляет STT
  const fillers = seededShuffle([
    // Эканье/мычание
    { t: 'эээ покажи задачи', expect: 'notion.list_tasks' },
    { t: 'ммм добавь задачу', expect: 'notion.create_task' },
    { t: 'эмм создай задачу купить молоко', expect: 'notion.create_task' },
    { t: 'ааа покажи идеи', expect: 'notion.list_ideas' },
    { t: 'ну покажи задачи на сегодня', expect: 'notion.list_tasks' },
    { t: 'ну типа добавь задачу', expect: 'notion.create_task' },
    { t: 'это самое покажи посты', expect: 'notion.list_social_posts' },
    { t: 'короче покажи задачи', expect: 'notion.list_tasks' },
    // В середине
    { t: 'покажи эээ задачи', expect: 'notion.list_tasks' },
    { t: 'добавь ммм задачу', expect: 'notion.create_task' },
    { t: 'создай ну задачу тест', expect: 'notion.create_task' },
    { t: 'покажи как бы задачи на завтра', expect: 'notion.list_tasks' },
    { t: 'удали эээ ну первую задачу', expect: 'notion.move_to_deprecated' },
    // В конце
    { t: 'покажи задачи эээ', expect: 'notion.list_tasks' },
    { t: 'добавь задачу купить молоко ммм', expect: 'notion.create_task' },
    { t: 'создай идею про тему ну', expect: 'notion.create_idea' },
    // Много паразитов
    { t: 'ну эээ покажи ммм задачи аа на сегодня', expect: 'notion.list_tasks' },
    { t: 'это короче добавь ну задачу типа тест', expect: 'notion.create_task' },
    // Повторы слов (STT дублирует)
    { t: 'покажи покажи задачи', expect: 'notion.list_tasks' },
    { t: 'добавь добавь задачу', expect: 'notion.create_task' },
  ]);

  for (const item of fillers.slice(0, 20)) {
    const c = {
      id: `stt_filler_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: { type: 'tool', toolName: item.expect },
    };
    if (item.t.includes('первую')) {
      c.lastShownList = lastShownList;
    }
    cases.push(c);
  }

  return cases;
}

function genMissingSpaces(defaults) {
  const cases = [];

  // Пропущенные пробелы (частичные склейки)
  const missing = seededShuffle([
    { t: 'покажи задачи насегодня', expect: 'notion.list_tasks' },
    { t: 'покажи задачи назавтра', expect: 'notion.list_tasks' },
    { t: 'добавь задачу купитьмолоко', expect: 'notion.create_task' },
    { t: 'создай задачу позвонитьмаме', expect: 'notion.create_task' },
    { t: 'покажи рабочиезадачи', expect: 'notion.list_tasks' },
    { t: 'покажи домашниедела', expect: 'notion.list_tasks' },
    { t: 'удали первуюзадачу', expect: 'notion.move_to_deprecated' },
    { t: 'обнови вторуюзадачу', expect: 'notion.update_task' },
    { t: 'отметь выполненнойзадачу один', expect: 'notion.mark_done' },
    { t: 'покажи идеипро тему', expect: 'notion.list_ideas' },
    { t: 'создай идеюпро интеграцию', expect: 'notion.create_idea' },
    { t: 'покажи постыв телеграме', expect: 'notion.list_social_posts' },
    { t: 'создай поствтелеграм', expect: 'notion.create_social_post' },
    { t: 'запиши вдневник', expect: 'notion.create_journal_entry' },
    { t: 'добавь впамять настройку', expect: null },
  ]);

  for (const item of missing.slice(0, 15)) {
    const c = {
      id: `stt_nospace_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      expected: item.expect
        ? { type: 'tool', toolName: item.expect }
        : { typeAnyOf: ['tool', 'chat'] },
    };
    if (item.t.includes('первую') || item.t.includes('вторую') || item.t.includes('один')) {
      c.lastShownList = lastShownList;
    }
    cases.push(c);
  }

  return cases;
}

function genWrongLayout(defaults) {
  const cases = [];

  // Неправильная раскладка клавиатуры (RU -> EN или EN -> RU)
  // Это может происходить когда STT путает языки
  const wrongLayout = seededShuffle([
    // EN вместо RU (покажи = gjrfb)
    { t: 'gjrfb pflfxb', expect: 'notion.list_tasks', comment: 'покажи задачи' },
    { t: 'ljkfym pflfxe', expect: 'notion.create_task', comment: 'добавь задачу' },
    { t: 'cjplfq pflfxe', expect: 'notion.create_task', comment: 'создай задачу' },
    { t: 'elfkb pflfxe', expect: 'notion.move_to_deprecated', comment: 'удали задачу' },
    { t: 'j,yjdb pflfxe', expect: 'notion.update_task', comment: 'обнови задачу' },
    // RU вместо EN (show = ыргц)
    { t: 'ыргц еыфвы', expect: null, comment: 'show tasks' },
    { t: 'сщуфеу ефыл', expect: null, comment: 'create task' },
    { t: 'фвв ефыл', expect: null, comment: 'add task' },
    // Частично неправильная раскладка
    { t: 'покажи pflfxb', expect: 'notion.list_tasks', comment: 'покажи + задачи на EN' },
    { t: 'добавь pflfxe', expect: 'notion.create_task', comment: 'добавь + задачу на EN' },
    { t: 'gjrfb задачи', expect: 'notion.list_tasks', comment: 'покажи на EN + задачи' },
    { t: 'show задачи', expect: 'notion.list_tasks', comment: 'show + задачи' },
    { t: 'add задачу', expect: 'notion.create_task', comment: 'add + задачу' },
    { t: 'create задачу', expect: 'notion.create_task', comment: 'create + задачу' },
    { t: 'delete задачу', expect: 'notion.move_to_deprecated', comment: 'delete + задачу' },
  ]);

  for (const item of wrongLayout.slice(0, 15)) {
    cases.push({
      id: `stt_layout_${md5(item.t)}`,
      userText: item.t,
      tz: defaults.tz,
      nowIso: defaults.nowIso,
      comment: item.comment,
      expected: item.expect
        ? { type: 'tool', toolName: item.expect }
        : { typeAnyOf: ['tool', 'chat'] },
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

  // Склеенные слова (25)
  allCases.push(...genGluedWords(defaults));

  // Опечатки в ключевых словах (25)
  allCases.push(...genTypos(defaults));

  // Лишние слова-паразиты (20)
  allCases.push(...genFillerWords(defaults));

  // Пропущенные пробелы (15)
  allCases.push(...genMissingSpaces(defaults));

  // Неправильная раскладка (15)
  allCases.push(...genWrongLayout(defaults));

  // Ensure exactly 100
  while (allCases.length < 100) {
    allCases.push({
      id: `stt_pad_${allCases.length}`,
      userText: `эээ покажи задачи ${allCases.length}`,
      tz,
      nowIso,
      expected: { type: 'tool', toolName: 'notion.list_tasks' },
    });
  }
  if (allCases.length > 100) {
    allCases.length = 100;
  }

  const outPath = path.join(repoRoot, 'apps', 'evals', 'ds', '09_2026-01-13_stt_errors_100.jsonl');
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

