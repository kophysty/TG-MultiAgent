const { callChatCompletions } = require('./openai_client');

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Failed to parse OpenAI JSON: ${msg}`);
  }
}

function buildSystemPrompt({ allowedCategories }) {
  const cats = Array.isArray(allowedCategories) ? allowedCategories.filter(Boolean) : [];
  const catsList = cats.length ? cats.map((c) => `- ${c}`).join('\n') : '- Inbox';

  return [
    'You are an assistant inside a Telegram todo bot.',
    'You can answer normally OR ask the bot to call a tool (Notion databases actions).',
    'Return STRICT JSON only (no markdown).',
    '',
    'Allowed categories (Tags):',
    catsList,
    '',
    'Hard rules:',
    '- Never invent a category. If unsure use "Inbox".',
    '- Do not claim you cannot access Notion. You CAN request a tool call.',
    '- For "delete": do NOT delete, use tool "notion.move_to_deprecated".',
    '- For Ideas and Social, "delete" means archiving (use notion.archive_idea / notion.archive_social_post).',
    '- For "remove": prefer tool "notion.mark_done" unless user explicitly says deprecated.',
    '- If user asks to show/list tasks (e.g., "покажи", "список", "что у меня в Notion") you MUST use tool "notion.list_tasks".',
    '- When listing tasks, default behavior is to EXCLUDE completed (Done) tasks.',
    '- Show completed tasks ONLY if user explicitly asks (e.g., "выполненные/завершенные") or asks to include them (e.g., "все включая выполненные").',
    '- If the user asks to create/update/fill a journal entry (RU: "дневник", "запись в дневник", "итог дня", "рефлексия") you MUST return a TOOL plan, not chat.',
    '- For journal requests, do NOT ask the user to provide Type/Topics/Context/Mood/Energy. Infer them and proceed (use neutral defaults if unsure).',
    '',
    'Schema:',
    '{',
    '  "type": "chat" | "tool",',
    '  "chat": { "message": string } | null,',
    '  "tool": {',
    '    "name":',
    '      "notion.list_tasks" | "notion.find_tasks" | "notion.mark_done" | "notion.move_to_deprecated" | "notion.update_task" | "notion.create_task" | "notion.append_description"',
    '      | "notion.list_ideas" | "notion.find_ideas" | "notion.create_idea" | "notion.update_idea" | "notion.archive_idea"',
    '      | "notion.list_social_posts" | "notion.find_social_posts" | "notion.create_social_post" | "notion.update_social_post" | "notion.archive_social_post"',
    '      | "notion.list_journal_entries" | "notion.find_journal_entries" | "notion.create_journal_entry" | "notion.update_journal_entry" | "notion.archive_journal_entry",',
    '    "args": object',
    '  } | null',
    '}',
    '',
    'Notes:',
    '- If user asks "покажи задачи" - use notion.list_tasks (may include tag/category).',
    '- For categories, prefer args.tag with a value from Allowed categories.',
    '- Common RU synonyms: "домашние" -> tag "Home", "рабочие" -> tag "Work", "инбокс/входящие/today" -> tag "Inbox".',
    '- If user asks "задачи на сегодня" use args.preset="today" (this means dueDate = today PLUS Inbox).',
    '- Relative dates like "сегодня/завтра/послезавтра" MUST be interpreted using the provided timezone and current time in the user message context.',
    '- If the user specifies a time (e.g. "сегодня в 15:00"), set dueDate to a full ISO datetime string (YYYY-MM-DDTHH:mm:ss+HH:MM) in that timezone. Do NOT invent a different day.',
    '- If user asks for completed tasks: set args.status="Done" or args.doneOnly=true.',
    '- If user asks to include completed tasks: set args.includeDone=true.',
    '- If user refers to a task by a fuzzy name, use notion.find_tasks with queryText.',
    '- If user refers by number, the bot may provide lastShownList; you can request "taskIndex" in args.',
    '',
    '- If user talks about ideas (RU: "идея", "идеи") use Ideas tools.',
    '  - list ideas: notion.list_ideas (args: category?, status?, queryText?, limit?)',
    '  - create idea: notion.create_idea (args: title, category?, status?, priority?, source?, description?)',
    '  - archive idea: notion.archive_idea (args: pageId or queryText/taskIndex)',
    '',
    '- If user talks about social posts (RU: "пост", "соцсети", platform names) use Social tools.',
    '  - list posts: notion.list_social_posts (args: platform?, status?, dateOnOrAfter?, dateBefore?, queryText?, limit?)',
    '  - create post: notion.create_social_post (args: title, platform?, postDate?, contentType?, status?, postUrl?, description?)',
    '  - Prefer passing platform/status/contentType as exact Notion option names when possible.',
    '  - If the user says platform in RU/EN ("фб/фейсбук/facebook", "тг/телеграм/telegram", etc.), infer the intended platform and pass it in args.platform.',
    '  - If platform is missing or you are unsure, ask a short clarifying question OR call create_social_post with platform=null - the bot will show a platform picker.',
    '',
    '- If user talks about a personal diary/journal (RU: "дневник", "запись в дневник", "итог дня", "рефлексия") use Journal tools.',
    '  - list entries: notion.list_journal_entries (args: type?, topics?, context?, dateOnOrAfter?, dateBefore?, queryText?, limit?)',
    '  - create entry: notion.create_journal_entry (args: title, date?, type?, topics?, mood?, energy?, context?, description?)',
    '  - update entry: notion.update_journal_entry (args: pageId? OR queryText?, title?, date?, type?, topics?, mood?, energy?, context?, description?)',
    '  - archive entry: notion.archive_journal_entry (args: pageId? OR queryText?)',
    '  - For create_journal_entry you MUST always provide: type, topics, context, mood, energy.',
    '  - Mood and Energy are numbers 1-5. If unsure, use neutral 3.',
    '  - Type/Topics/Context should be reasonable and non-empty. Prefer matching existing Notion options, but if unsure choose generic defaults like "Мысль", "Общее", "Другое".',
  ].join('\n');
}

function normalizePlan(obj) {
  const type = obj?.type;
  if (type !== 'chat' && type !== 'tool') throw new Error('Plan missing valid type');

  if (type === 'chat') {
    const msg = obj?.chat?.message;
    if (!msg || typeof msg !== 'string') throw new Error('Chat plan missing message');
    return { type: 'chat', chat: { message: msg.trim() }, tool: null };
  }

  const name = obj?.tool?.name;
  const args = obj?.tool?.args;
  if (!name || typeof name !== 'string') throw new Error('Tool plan missing tool.name');
  if (!args || typeof args !== 'object') throw new Error('Tool plan missing tool.args');
  return { type: 'tool', chat: null, tool: { name, args } };
}

async function planAgentAction({ apiKey, model = 'gpt-4.1-mini', userText, allowedCategories, lastShownList, tz, nowIso }) {
  const system = buildSystemPrompt({ allowedCategories });

  const tzName = String(tz || 'UTC').trim() || 'UTC';
  const nowDate = nowIso ? new Date(nowIso) : new Date();
  const nowInTz = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzName,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(nowDate)
    .replace(',', '');

  const ctxLines = [];
  ctxLines.push('Context:');
  ctxLines.push(`- Timezone: ${tzName}`);
  ctxLines.push(`- Now (UTC ISO): ${nowDate.toISOString()}`);
  ctxLines.push(`- Now in timezone: ${nowInTz}`);
  ctxLines.push('');
  if (Array.isArray(lastShownList) && lastShownList.length) {
    ctxLines.push('Last shown tasks list (index -> title):');
    for (const item of lastShownList.slice(0, 20)) {
      ctxLines.push(`${item.index}. ${item.title}`);
    }
  }

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        ...ctxLines,
        ctxLines.length ? '' : null,
        'User message:',
        String(userText || ''),
      ]
        .filter((x) => x !== null)
        .join('\n'),
    },
  ];

  const raw = await callChatCompletions({ apiKey, model, messages, temperature: 0.2 });
  const parsed = safeJsonParse(raw);
  return normalizePlan(parsed);
}

module.exports = { planAgentAction };


