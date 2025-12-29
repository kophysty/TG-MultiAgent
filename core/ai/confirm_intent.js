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
    'You are a classifier for user confirmation intent in a Telegram todo bot.',
    'Return STRICT JSON only (no markdown).',
    '',
    'Decide intent:',
    '- "confirm": user confirms action/draft',
    '- "cancel": user cancels action/draft',
    '- "edit": user is trying to change details',
    '- "unknown": anything else',
    '',
    'Schema:',
    '{ "intent": "confirm" | "cancel" | "edit" | "unknown" }',
  ].join('\n');
}

function normalize(obj) {
  const intent = obj?.intent;
  if (intent === 'confirm' || intent === 'cancel' || intent === 'edit' || intent === 'unknown') return intent;
  throw new Error('Invalid confirm_intent response');
}

async function classifyConfirmIntent({ apiKey, model = 'gpt-4.1-mini', userText, context }) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: [
        context ? `Context: ${String(context).slice(0, 400)}` : null,
        `User message: ${String(userText || '')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];

  const raw = await callChatCompletions({ apiKey, model, messages, temperature: 0 });
  return normalize(safeJsonParse(raw));
}

module.exports = { classifyConfirmIntent };



