const { callChatCompletions } = require('./openai_client');

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Failed to parse OpenAI JSON: ${msg}`);
  }
}

function clampPreview(text, maxLen) {
  const t = String(text || '');
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

function buildSystemPrompt({ tz, nowIso }) {
  return [
    'You are a Telegram assistant inside a to-do bot.',
    'Your job: classify the user message as either a QUESTION or a TASK for Notion, and return STRICT JSON.',
    '',
    'Rules:',
    '- Output MUST be valid JSON object (no markdown, no extra keys).',
    '- Output language for user-facing fields must be Russian.',
    '- If it is a question: provide a short helpful answer in Russian.',
    '- If it is a task: extract fields (title, dueDate, priority). If missing, set null.',
    '- Interpret relative dates using timezone: ' + tz,
    '- Current datetime ISO (for reference): ' + nowIso,
    '',
    'Schema:',
    '{',
    '  "type": "question" | "task",',
    '  "question": { "answer": string } | null,',
    '  "task": {',
    '    "title": string,',
    '    "dueDate": "YYYY-MM-DD" | null,',
    '    "priority": "Low" | "Medium" | "High" | null,',
    '    "tags": string[],',
    '    "pmd": number | null,',
    '    "status": "Idle",',
    '    "clarifyingQuestion": string | null',
    '  } | null',
    '}',
  ].join('\n');
}

function normalizeAiResult(obj) {
  const type = obj && typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  if (type !== 'question' && type !== 'task') {
    throw new Error('AI result missing valid "type"');
  }

  if (type === 'question') {
    const answer = obj?.question?.answer;
    if (!answer || typeof answer !== 'string') throw new Error('AI question missing answer');
    return { type: 'question', question: { answer: answer.trim() }, task: null };
  }

  const title = obj?.task?.title;
  if (!title || typeof title !== 'string') throw new Error('AI task missing title');

  const dueDate = obj?.task?.dueDate ?? null;
  const priority = obj?.task?.priority ?? null;
  const tags = Array.isArray(obj?.task?.tags) ? obj.task.tags.filter((x) => typeof x === 'string' && x.trim()) : [];
  const pmd = typeof obj?.task?.pmd === 'number' && Number.isFinite(obj.task.pmd) ? obj.task.pmd : null;
  const clarifyingQuestion = typeof obj?.task?.clarifyingQuestion === 'string' ? obj.task.clarifyingQuestion.trim() : null;

  return {
    type: 'task',
    question: null,
    task: {
      title: title.trim(),
      dueDate: typeof dueDate === 'string' && dueDate.trim() ? dueDate.trim() : null,
      priority: priority === 'Low' || priority === 'Medium' || priority === 'High' ? priority : null,
      tags,
      pmd,
      status: 'Idle',
      clarifyingQuestion: clarifyingQuestion || null,
    },
  };
}

async function aiAnalyzeMessage({
  apiKey,
  model = 'gpt-4.1-mini',
  tz = 'Europe/Moscow',
  nowIso = new Date().toISOString(),
  userText,
  priorTaskDraft,
}) {
  const system = buildSystemPrompt({ tz, nowIso });

  const userParts = [];
  userParts.push('User message:');
  userParts.push(String(userText || ''));

  if (priorTaskDraft) {
    userParts.push('');
    userParts.push('Previous task draft JSON:');
    userParts.push(JSON.stringify(priorTaskDraft));
    userParts.push('');
    userParts.push('If the user is correcting, update the task fields accordingly.');
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n') },
  ];

  const raw = await callChatCompletions({ apiKey, model, messages, temperature: 0.2 });
  const parsed = safeJsonParse(raw);
  const normalized = normalizeAiResult(parsed);

  return {
    normalized,
    debug: { model, tz, nowIso, userTextPreview: clampPreview(userText, 80) },
  };
}

module.exports = { aiAnalyzeMessage };


