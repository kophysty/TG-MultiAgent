const test = require('node:test');
const assert = require('node:assert/strict');

const { inferTasksWeekRangeFromText, inferSocialWeekRangeFromText } = require('../dialogs/todo_bot_helpers');

test('inferTasksWeekRangeFromText: "на эту неделю" returns an interval', () => {
  const tz = 'Europe/Moscow';
  const res = inferTasksWeekRangeFromText({ userText: 'покажи задачи на эту неделю', tz });
  assert.ok(res, 'expected a result');
  assert.equal(res.kind, 'this_week');
  assert.ok(res.dateOnOrAfter, 'expected dateOnOrAfter');
  assert.ok(res.dateBefore, 'expected dateBefore');
  assert.match(res.dateOnOrAfter, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(res.dateBefore, /^\d{4}-\d{2}-\d{2}$/);
});

test('inferSocialWeekRangeFromText: "на эту неделю" returns an interval', () => {
  const tz = 'Europe/Moscow';
  const res = inferSocialWeekRangeFromText({ userText: 'покажи посты на эту неделю', tz });
  assert.ok(res, 'expected a result');
  assert.ok(res.dateOnOrAfter, 'expected dateOnOrAfter');
  assert.ok(res.dateBefore, 'expected dateBefore');
  assert.match(res.dateOnOrAfter, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(res.dateBefore, /^\d{4}-\d{2}-\d{2}$/);
});


