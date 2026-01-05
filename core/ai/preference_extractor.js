const { callChatCompletions } = require('./openai_client');

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Failed to parse OpenAI JSON: ${msg}`);
  }
}

function isLikelyPreferenceText(userText) {
  const t = String(userText || '').toLowerCase();
  if (!t.trim()) return false;

  // Explicit "remember" style requests.
  if (/(запомни|запоминай|сохрани|сохран(и|ять)|remember)/.test(t)) return true;

  // Heuristic signals that the user is describing a stable preference.
  if (/(я\s+предпочитаю|мне\s+нравит(ся|ься)|мне\s+не\s+нравит(ся|ься)|я\s+не\s+люблю)/.test(t)) return true;
  if (/(пожалуйста|плиз|pls|пиши|говори|отвечай)/.test(t) && /(всегда|никогда|обычно|по\s+умолчанию)/.test(t)) return true;
  if (/(формат|коротко|подробно|списком|таблицей|без\s+эмодзи)/.test(t)) return true;
  if (/(таймзон|timezone|мск|moscow|utc)/.test(t)) return true;

  return false;
}

function buildSystemPrompt() {
  return [
    'Ты извлекаешь предпочтения пользователя из одного сообщения Telegram.',
    'Нужно предложить сохранить только устойчивые предпочтения, а не разовые задачи.',
    'Ответ должен быть СТРОГО JSON (без markdown).',
    '',
    'Правила:',
    '- Верни 0-2 кандидата.',
    '- Если уверенность низкая - верни пустой список.',
    '- Не включай токены, ключи, пароли. Если пользователь прислал секрет, НЕ сохраняй его как preference.',
    '',
    'Схема:',
    '{',
    '  "candidates": [',
    '    {',
    '      "key": string,',
    '      "scope": "global",',
    '      "category": string|null,',
    '      "value_human": string,',
    '      "value_json": object,',
    '      "confidence": number,',
    '      "reason": string',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

function normalizeResult(obj) {
  const arr = Array.isArray(obj?.candidates) ? obj.candidates : [];
  const out = [];
  for (const c of arr.slice(0, 2)) {
    const key = String(c?.key || '').trim();
    const scope = 'global';
    const category = c?.category === null || c?.category === undefined ? null : String(c.category || '').trim() || null;
    const valueHuman = String(c?.value_human || '').trim();
    const valueJson = c?.value_json && typeof c.value_json === 'object' && !Array.isArray(c.value_json) ? c.value_json : {};
    const confidence = Number(c?.confidence);
    const reason = String(c?.reason || '').trim();
    if (!key || !valueHuman) continue;
    if (!Number.isFinite(confidence)) continue;
    if (confidence < 0.75) continue;
    out.push({ key, scope, category, valueHuman, valueJson, confidence, reason });
  }
  return out;
}

async function extractPreferences({ apiKey, model = 'gpt-4.1-mini', userText, preferencesSummary = '', chatSummary = '', chatHistory = '' }) {
  const system = buildSystemPrompt();
  const prompt = [
    preferencesSummary ? 'Текущие preferences summary:' : null,
    preferencesSummary ? String(preferencesSummary) : null,
    '',
    chatSummary ? 'Chat summary:' : null,
    chatSummary ? String(chatSummary) : null,
    '',
    chatHistory ? 'Recent chat messages:' : null,
    chatHistory ? String(chatHistory) : null,
    '',
    'User message:',
    String(userText || ''),
  ]
    .filter((x) => x !== null)
    .join('\n');

  const raw = await callChatCompletions({
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
  });
  const parsed = safeJsonParse(raw);
  return normalizeResult(parsed);
}

module.exports = { extractPreferences, isLikelyPreferenceText };




