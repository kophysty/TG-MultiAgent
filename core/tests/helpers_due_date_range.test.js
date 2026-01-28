const test = require('node:test');
const assert = require('node:assert/strict');

const { inferDateFromText, inferDueDateFromUserText, normalizeDueDateInput } = require('../dialogs/todo_bot_helpers');

test('inferDateFromText: parses RU month with explicit year', () => {
  const tz = 'Europe/Moscow';
  assert.equal(inferDateFromText({ userText: 'на 23 января 2026', tz }), '2026-01-23');
  assert.equal(inferDateFromText({ userText: '23-го января 2026 года', tz }), '2026-01-23');
});

test('inferDueDateFromUserText: does not treat "на 23 января 2026" as time 23:00', () => {
  const tz = 'Europe/Moscow';
  const v = inferDueDateFromUserText({ userText: 'Добавь задачу на 23 января 2026', tz });
  assert.equal(v, '2026-01-23');
});

test('normalizeDueDateInput: converts "YYYY-MM-DD HH:mm" to ISO with offset in tz', () => {
  const tz = 'Europe/Moscow';
  const v = normalizeDueDateInput({ dueDate: '2026-01-23 14:00', tz });
  assert.ok(typeof v === 'string');
  assert.ok(v.startsWith('2026-01-23T14:00:00'));
  assert.ok(v.endsWith('+03:00'));
});

