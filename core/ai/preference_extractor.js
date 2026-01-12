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
  if (/(запомни(ть|те)?|запоминай|сохрани|сохран(и|ять)|remember)/.test(t)) return true;

  // Explicit "prefs:" / "preferences:" / "предпочтения:" shorthand.
  if (/^\s*(preferences?|предпочтен(ие|ия))\s*[:=-]/.test(t)) return true;

  // Explicit "write down / add to preferences" style requests.
  // Guard: avoid triggering on tasks like "добавь задачу".
  const mentionsPreferences =
    /(preferences?|преф(ы|ы)?|предпочтен(ие|ия|иям|иях|ий)|в\s+память|постоянн(ую|ая)\s+память)/.test(t);
  const writeDownVerb = /(запиши|занеси|внеси|зафиксируй|добав(ь|ьте|ить)|сохрани)/.test(t);
  const looksLikeTask = /(задач(у|и|а|ей)|таск(и|а|ов)?|todo|to-do)/.test(t);
  const mentionsMemory = /((?:в|во)\s+память|постоянн(ую|ая)\s+память)/.test(t);
  if (writeDownVerb && mentionsMemory) return true;
  if (writeDownVerb && mentionsPreferences && !looksLikeTask) return true;

  // Heuristic signals that the user is describing a stable preference.
  if (/(я\s+предпочитаю|мне\s+нравит(ся|ься)|мне\s+не\s+нравит(ся|ься)|я\s+не\s+люблю)/.test(t)) return true;
  if (/(пожалуйста|плиз|pls|пиши|говори|отвечай)/.test(t) && /(всегда|никогда|обычно|по\s+умолчанию)/.test(t)) return true;
  if (/(формат|коротко|подробно|списком|таблицей|без\s+эмодзи)/.test(t)) return true;
  if (/эмодзи/.test(t) && /(без|никогда|не\s+используй|не\s+надо|не\s+нужно)/.test(t)) return true;
  if (/(таймзон|timezone|мск|moscow|utc)/.test(t)) return true;

  return false;
}

function extractExplicitMemoryNoteText(userText) {
  const s = String(userText || '').trim();
  if (!s) return null;

  // Capture everything after an explicit "remember/save to memory" request.
  // Important: avoid treating "в память" itself as the payload.

  // Variant A: verb + explicit memory marker + payload
  const reWithMemory =
    /^\s*(?:пожалуйста\s+)?(?:запомни(?:ть|те)?|запоминай|запиши|занеси|внеси|зафиксируй|сохрани|добав(?:ь|ьте|ить)|remember)\s*(?:мне\s*)?(?:(?:в|во)\s+постоянн(?:ую|ая)\s+память|(?:в|во)\s+память|in\s+memory|to\s+memory)\s*[:,-]?\s*(.+)\s*$/i;

  // Variant B: "запомни" without explicit "в память", still treat as memory request.
  const reZapomniOnly = /^\s*(?:пожалуйста\s+)?(?:запомни(?:ть|те)?|запоминай|remember)\s*[:,-]?\s*(.+)\s*$/i;

  const m1 = s.match(reWithMemory);
  if (m1) {
    const rest = String(m1[1] || '');
    const cleaned = rest.replace(/^[:,-]+/g, '').trim();
    return cleaned || null;
  }

  const m2 = s.match(reZapomniOnly);
  if (m2) {
    const rest = String(m2[1] || '');
    const cleaned = rest.replace(/^[:,-]+/g, '').trim();
    return cleaned || null;
  }

  return null;
}

function isExplicitMemoryCommandWithoutPayload(userText) {
  const s = String(userText || '').trim();
  if (!s) return false;
  const re =
    /^\s*(?:пожалуйста\s+)?(?:запомни(?:ть|те)?|запоминай|запиши|занеси|внеси|зафиксируй|сохрани|добав(?:ь|ьте|ить)|remember)\s*(?:мне\s*)?(?:(?:в|во)\s+постоянн(?:ую|ая)\s+память|(?:в|во)\s+память|in\s+memory|to\s+memory)?\s*[:,-]?\s*$/i;
  return re.test(s);
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

module.exports = { extractPreferences, isLikelyPreferenceText, extractExplicitMemoryNoteText, isExplicitMemoryCommandWithoutPayload };




