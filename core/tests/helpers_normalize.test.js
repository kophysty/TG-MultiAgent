const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTitleKey,
  buildQueryVariants,
  pickBestOptionMatch,
  normalizeMultiOptionValue,
  clampRating1to5,
} = require('../dialogs/todo_bot_helpers');

test('normalizeTitleKey: lowercases, strips punctuation, keeps letters and digits', () => {
  assert.equal(normalizeTitleKey(' Hello, Мир! 123-45 '), 'hello мир 12345');
});

test('buildQueryVariants: glues spaced digits into a variant', () => {
  const v = buildQueryVariants('1 2 3 4 cool');
  assert.ok(Array.isArray(v));
  assert.ok(v.includes('1234 cool'));
});

test('pickBestOptionMatch: returns exact option (case-insensitive)', () => {
  const res = pickBestOptionMatch({ input: 'work', options: ['Home', 'Work', 'Inbox'] });
  assert.deepEqual(res, { value: 'Work', unknown: null });
});

test('pickBestOptionMatch: returns null + unknown when nothing matches', () => {
  const res = pickBestOptionMatch({ input: 'SomethingElse', options: ['Home', 'Work', 'Inbox'] });
  assert.equal(res.value, null);
  assert.equal(res.unknown, 'SomethingElse');
});

test('normalizeMultiOptionValue: normalizes array and dedupes', () => {
  const res = normalizeMultiOptionValue({ value: ['Work', 'work', 'Inbox'], options: ['Home', 'Work', 'Inbox'] });
  assert.deepEqual(res.value, ['Work', 'Inbox']);
  assert.deepEqual(res.unknown, []);
});

test('clampRating1to5: rounds and clamps', () => {
  assert.equal(clampRating1to5(0), 1);
  assert.equal(clampRating1to5(1.2), 1);
  assert.equal(clampRating1to5(3.6), 4);
  assert.equal(clampRating1to5(6), 5);
  assert.equal(clampRating1to5('nope'), null);
});


