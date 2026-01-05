const test = require('node:test');
const assert = require('node:assert/strict');

const { inferListHintsFromText } = require('../dialogs/todo_bot_helpers');

test('inferListHintsFromText: detects today preset', () => {
  const res = inferListHintsFromText('покажи задачи на сегодня');
  assert.deepEqual(res, { preset: 'today', tag: null, doneMode: 'exclude' });
});

test('inferListHintsFromText: detects day after tomorrow preset', () => {
  const res = inferListHintsFromText('покажи задачи на послезавтра');
  assert.deepEqual(res, { preset: 'day_after_tomorrow', tag: null, doneMode: 'exclude' });
});

test('inferListHintsFromText: detects work tag', () => {
  const res = inferListHintsFromText('покажи рабочие задачи');
  assert.deepEqual(res, { preset: null, tag: 'Work', doneMode: 'exclude' });
});

test('inferListHintsFromText: doneMode only when user asks for completed', () => {
  const res = inferListHintsFromText('покажи выполненные задачи');
  assert.deepEqual(res, { preset: null, tag: null, doneMode: 'only' });
});



