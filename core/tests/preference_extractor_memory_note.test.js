const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractExplicitMemoryNoteText,
  isLikelyPreferenceText,
  isExplicitMemoryCommandWithoutPayload,
} = require('../ai/preference_extractor');

test('extractExplicitMemoryNoteText parses "запомни ..."', () => {
  assert.equal(extractExplicitMemoryNoteText('запомни что мы пишем в Facebook'), 'что мы пишем в Facebook');
});

test('extractExplicitMemoryNoteText parses "добавь в память: ..."', () => {
  assert.equal(extractExplicitMemoryNoteText('добавь в память: мы пишем в Facebook и Telegram'), 'мы пишем в Facebook и Telegram');
});

test('extractExplicitMemoryNoteText parses "сохрани в постоянную память ..."', () => {
  assert.equal(
    extractExplicitMemoryNoteText('сохрани в постоянную память то, что мы пишем в Facebook'),
    'то, что мы пишем в Facebook'
  );
});

test('extractExplicitMemoryNoteText returns null when no payload', () => {
  assert.equal(extractExplicitMemoryNoteText('запомни'), null);
  assert.equal(extractExplicitMemoryNoteText('добавь в память'), null);
});

test('isExplicitMemoryCommandWithoutPayload detects commands without payload', () => {
  assert.equal(isExplicitMemoryCommandWithoutPayload('запомни'), true);
  assert.equal(isExplicitMemoryCommandWithoutPayload('добавь в память'), true);
  assert.equal(isExplicitMemoryCommandWithoutPayload('пожалуйста запомни:'), true);
});

test('isExplicitMemoryCommandWithoutPayload is false when payload is present', () => {
  assert.equal(isExplicitMemoryCommandWithoutPayload('запомни что мы пишем в Facebook'), false);
  assert.equal(isExplicitMemoryCommandWithoutPayload('добавь в память: мы пишем в Telegram'), false);
});

test('extractExplicitMemoryNoteText supports punctuation and casing', () => {
  assert.equal(extractExplicitMemoryNoteText('Запомни: мы пишем в Facebook'), 'мы пишем в Facebook');
  assert.equal(extractExplicitMemoryNoteText('пожалуйста запомни - мы пишем в Telegram'), 'мы пишем в Telegram');
  assert.equal(extractExplicitMemoryNoteText('запомни, что мы пишем в LinkedIn'), 'что мы пишем в LinkedIn');
});

test('extractExplicitMemoryNoteText supports more verbs with explicit memory marker', () => {
  assert.equal(extractExplicitMemoryNoteText('внеси в память: мы постим по понедельникам'), 'мы постим по понедельникам');
  assert.equal(extractExplicitMemoryNoteText('занеси в память мы постим по вторникам'), 'мы постим по вторникам');
  assert.equal(extractExplicitMemoryNoteText('зафиксируй в память то что мы постим по средам'), 'то что мы постим по средам');
  assert.equal(extractExplicitMemoryNoteText('сохрани в память: мы постим по четвергам'), 'мы постим по четвергам');
});

test('extractExplicitMemoryNoteText does not treat non-memory "добавь ..." as a memory note', () => {
  assert.equal(extractExplicitMemoryNoteText('добавь задачу купить хлеб'), null);
  assert.equal(extractExplicitMemoryNoteText('добавь тег work'), null);
});

test('isLikelyPreferenceText treats "добавь в память задачу ..." as memory intent (explicit memory marker wins)', () => {
  assert.equal(isLikelyPreferenceText('добавь в память задачу купить хлеб'), true);
  assert.equal(extractExplicitMemoryNoteText('добавь в память задачу купить хлеб'), 'задачу купить хлеб');
});

test('isLikelyPreferenceText detects explicit remember phrases', () => {
  assert.equal(isLikelyPreferenceText('запомни что мы пишем в Facebook'), true);
  assert.equal(isLikelyPreferenceText('добавь в память: мы пишем в Telegram'), true);
  assert.equal(isLikelyPreferenceText('сохрани в постоянную память: мы пишем в LinkedIn'), true);
});

test('isLikelyPreferenceText avoids common task phrasing for "добавь ..."', () => {
  assert.equal(isLikelyPreferenceText('добавь задачу купить хлеб'), false);
  assert.equal(isLikelyPreferenceText('добавь таск купить хлеб'), false);
  assert.equal(isLikelyPreferenceText('добавь todo купить хлеб'), false);
});

test('isLikelyPreferenceText detects stable preference language', () => {
  assert.equal(isLikelyPreferenceText('мне нравится, когда ты отвечаешь коротко'), true);
  assert.equal(isLikelyPreferenceText('пожалуйста всегда отвечай списком'), true);
  assert.equal(isLikelyPreferenceText('без эмодзи, пожалуйста'), true);
});

test('isLikelyPreferenceText detects timezone hints', () => {
  assert.equal(isLikelyPreferenceText('таймзона мск'), true);
  assert.equal(isLikelyPreferenceText('timezone Europe/Moscow'), true);
});

test('isLikelyPreferenceText returns false for empty or whitespace', () => {
  assert.equal(isLikelyPreferenceText(''), false);
  assert.equal(isLikelyPreferenceText('   '), false);
});

test('isLikelyPreferenceText returns false for common CRUD commands', () => {
  assert.equal(isLikelyPreferenceText('покажи список задач'), false);
  assert.equal(isLikelyPreferenceText('удали задачу test'), false);
  assert.equal(isLikelyPreferenceText('/today'), false);
});

test('isLikelyPreferenceText detects "preferences/предпочтения/память" mentions with write verbs', () => {
  assert.equal(isLikelyPreferenceText('запиши в preferences: я пишу коротко'), true);
  assert.equal(isLikelyPreferenceText('зафиксируй предпочтения: без эмодзи'), true);
  assert.equal(isLikelyPreferenceText('добавь в постоянную память: мы ведем соцсети так-то'), true);
});

test('isLikelyPreferenceText supports shorthand "preferences: ..." and "предпочтения: ..."', () => {
  assert.equal(isLikelyPreferenceText('preferences: я люблю списки'), true);
  assert.equal(isLikelyPreferenceText('предпочтения: отвечай коротко'), true);
});

test('extractExplicitMemoryNoteText parses "запомни в память ..." too', () => {
  assert.equal(extractExplicitMemoryNoteText('запомни в память что мы пишем в Facebook'), 'что мы пишем в Facebook');
});

test('extractExplicitMemoryNoteText trims payload and ignores extra spaces', () => {
  assert.equal(extractExplicitMemoryNoteText('  запомни:   мы пишем в Facebook   '), 'мы пишем в Facebook');
});

test('extractExplicitMemoryNoteText does not match "сохрани ..." without memory marker (except zapomni)', () => {
  assert.equal(extractExplicitMemoryNoteText('сохрани это на потом'), null);
  assert.equal(extractExplicitMemoryNoteText('зафиксируй это'), null);
});

test('isLikelyPreferenceText detects formatting preferences', () => {
  assert.equal(isLikelyPreferenceText('отвечай коротко'), true);
  assert.equal(isLikelyPreferenceText('пиши подробно'), true);
  assert.equal(isLikelyPreferenceText('отвечай таблицей'), true);
  assert.equal(isLikelyPreferenceText('отвечай списком'), true);
});

test('isLikelyPreferenceText detects default behavior modifiers', () => {
  assert.equal(isLikelyPreferenceText('по умолчанию отвечай коротко'), true);
  assert.equal(isLikelyPreferenceText('обычно отвечай подробно'), true);
  assert.equal(isLikelyPreferenceText('всегда отвечай без эмодзи'), true);
  assert.equal(isLikelyPreferenceText('никогда не используй эмодзи'), true);
});

test('isLikelyPreferenceText tolerates English remember', () => {
  assert.equal(isLikelyPreferenceText('remember that we post to facebook'), true);
});

test('extractExplicitMemoryNoteText supports English remember', () => {
  assert.equal(extractExplicitMemoryNoteText('remember: we post to facebook'), 'we post to facebook');
  assert.equal(extractExplicitMemoryNoteText('remember we post to telegram'), 'we post to telegram');
  assert.equal(extractExplicitMemoryNoteText('remember in memory: we post to linkedin'), 'we post to linkedin');
});

test('isLikelyPreferenceText remains false for neutral chatter', () => {
  assert.equal(isLikelyPreferenceText('привет как дела'), false);
  assert.equal(isLikelyPreferenceText('ок'), false);
});

test('isLikelyPreferenceText detects emoji preference even without "без эмодзи"', () => {
  assert.equal(isLikelyPreferenceText('никогда не используй эмодзи'), true);
  assert.equal(isLikelyPreferenceText('эмодзи не надо'), true);
  assert.equal(isLikelyPreferenceText('эмодзи не нужно'), true);
});

test('isLikelyPreferenceText does not trigger on "эмодзи" without a negation', () => {
  assert.equal(isLikelyPreferenceText('эмодзи'), false);
  assert.equal(isLikelyPreferenceText('добавь эмодзи в задачу'), false);
});

test('extractExplicitMemoryNoteText supports no-space punctuation', () => {
  assert.equal(extractExplicitMemoryNoteText('запомни:Facebook'), 'Facebook');
  assert.equal(extractExplicitMemoryNoteText('запомни-Facebook'), 'Facebook');
});

test('extractExplicitMemoryNoteText supports "пожалуйста добавь в память ..."', () => {
  assert.equal(extractExplicitMemoryNoteText('пожалуйста добавь в память мы пишем в Telegram'), 'мы пишем в Telegram');
});

test('extractExplicitMemoryNoteText supports "добавь в память - ..."', () => {
  assert.equal(extractExplicitMemoryNoteText('добавь в память - мы пишем в Facebook'), 'мы пишем в Facebook');
});

test('extractExplicitMemoryNoteText supports "запомнить ..." and "запомните ..." forms', () => {
  assert.equal(extractExplicitMemoryNoteText('запомнить что мы пишем в Facebook'), 'что мы пишем в Facebook');
  assert.equal(extractExplicitMemoryNoteText('запомните что мы пишем в Telegram'), 'что мы пишем в Telegram');
});

test('isLikelyPreferenceText supports "запомнить/запомните"', () => {
  assert.equal(isLikelyPreferenceText('запомнить что мы пишем в Facebook'), true);
  assert.equal(isLikelyPreferenceText('запомните что мы пишем в Telegram'), true);
});

