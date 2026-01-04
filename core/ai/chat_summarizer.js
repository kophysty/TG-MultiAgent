const { callChatCompletions } = require('./openai_client');

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Failed to parse OpenAI JSON: ${msg}`);
  }
}

function buildSystemPrompt() {
  return [
    'Ты помощник, который делает краткую сводку диалога Telegram бота.',
    'Нужно обновить краткое резюме чата для последующего восстановления контекста после рестарта.',
    'Ответ должен быть СТРОГО JSON (без markdown).',
    '',
    'Требования к summary:',
    '- на русском',
    '- коротко, 5-12 строк',
    '- фиксируй важные факты и текущий контекст обсуждения',
    '- не включай секреты, токены, ключи, пароли (даже если они встречаются во входе)',
    '- не переписывай весь лог, только суть',
    '',
    'Схема ответа:',
    '{ "summary": string }',
  ].join('\n');
}

function formatMessagesForPrompt(messages) {
  const arr = Array.isArray(messages) ? messages : [];
  const lines = [];
  for (const m of arr.slice(-80)) {
    const role = String(m?.role || '').trim() || 'unknown';
    const text = String(m?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push(`${role}: ${text}`);
  }
  return lines.join('\n');
}

async function summarizeChat({ apiKey, model = 'gpt-4.1-mini', priorSummary = '', messages = [] }) {
  const system = buildSystemPrompt();
  const prior = String(priorSummary || '').trim();
  const chat = formatMessagesForPrompt(messages);

  const userContent = [
    prior ? 'Предыдущее summary:' : null,
    prior ? prior : null,
    '',
    'Последние сообщения:',
    chat || '(пусто)',
    '',
    'Сделай обновленное summary.',
  ]
    .filter((x) => x !== null)
    .join('\n');

  const raw = await callChatCompletions({
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
  });

  const parsed = safeJsonParse(raw);
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
  if (!summary) throw new Error('Chat summary missing summary');
  return { summary };
}

module.exports = { summarizeChat };



