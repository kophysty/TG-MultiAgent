const { callChatCompletions } = require('./openai_client');

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error(`Failed to parse OpenAI JSON: ${msg}`);
  }
}

function isPlainObject(x) {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x));
}

function normalizeToolArgsCommon(args) {
  if (!isPlainObject(args)) return args;
  const out = { ...args };

  // Common key aliases across models and providers.
  if (out.pageId === undefined && out.page_id !== undefined) out.pageId = out.page_id;
  if (out.taskIndex === undefined && out.index !== undefined) out.taskIndex = out.index;
  if (out.taskIndex === undefined && out.task_index !== undefined) out.taskIndex = out.task_index;
  if (out.queryText === undefined && out.query !== undefined) out.queryText = out.query;
  if (out.queryText === undefined && out.query_text !== undefined) out.queryText = out.query_text;

  return out;
}

function normalizeToolArgsByToolName(toolName, args) {
  const out = normalizeToolArgsCommon(args);
  if (!isPlainObject(out)) return out;

  function addDaysToYyyyMmDd(ymd, days) {
    const s = String(ymd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const dt = new Date(`${s}T00:00:00.000Z`);
    if (!Number.isFinite(dt.getTime())) return null;
    dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
    return dt.toISOString().slice(0, 10);
  }

  // Task list schema is special: executor expects dueDate and dueDate range keys.
  if (toolName === 'notion.list_tasks') {
    if (out.dueDate === undefined && out.date !== undefined) out.dueDate = out.date;
    if (out.dueDateOnOrAfter === undefined && out.dateOnOrAfter !== undefined) out.dueDateOnOrAfter = out.dateOnOrAfter;
    if (out.dueDateBefore === undefined && out.dateBefore !== undefined) out.dueDateBefore = out.dateBefore;

    // Some models prefer range even for a single day. Convert to dueDate when range is exactly one day.
    if (out.dueDate === undefined && out.dueDateOnOrAfter !== undefined && out.dueDateBefore !== undefined) {
      const from = String(out.dueDateOnOrAfter).slice(0, 10);
      const before = String(out.dueDateBefore).slice(0, 10);
      const expectedBefore = addDaysToYyyyMmDd(from, 1);
      if (expectedBefore && before === expectedBefore) out.dueDate = from;
    }
  }

  // Social list schema is the inverse: it expects dateOnOrAfter/dateBefore.
  if (toolName === 'notion.list_social_posts') {
    if (out.dateOnOrAfter === undefined && out.dueDateOnOrAfter !== undefined) out.dateOnOrAfter = out.dueDateOnOrAfter;
    if (out.dateBefore === undefined && out.dueDateBefore !== undefined) out.dateBefore = out.dueDateBefore;
  }

  // Common task create/update aliases.
  if (toolName === 'notion.create_task' || toolName === 'notion.update_task') {
    if (out.tag === undefined && out.category !== undefined) out.tag = out.category;
    if (out.tag === undefined && Array.isArray(out.tags) && out.tags.length) out.tag = out.tags[0];
    if (out.dueDate === undefined && out.due !== undefined) out.dueDate = out.due;
    if (out.dueDate === undefined && out.deadline !== undefined) out.dueDate = out.deadline;
    if (out.dueDateEnd === undefined && out.dueEnd !== undefined) out.dueDateEnd = out.dueEnd;
    if (out.dueDateEnd === undefined && out.end !== undefined) out.dueDateEnd = out.end;
    if (out.dueDateEnd === undefined && out.due_end !== undefined) out.dueDateEnd = out.due_end;
    if (out.dueDateEnd === undefined && out.endDate !== undefined) out.dueDateEnd = out.endDate;
    if (out.title === undefined && out.name !== undefined) out.title = out.name;
  }

  // Append description: sometimes models use description instead of text.
  if (toolName === 'notion.append_description') {
    if (out.text === undefined && out.description !== undefined) out.text = out.description;
  }

  return out;
}

function buildSystemPrompt({ allowedCategories }) {
  const cats = Array.isArray(allowedCategories) ? allowedCategories.filter(Boolean) : [];
  const catsList = cats.length ? cats.map((c) => `- ${c}`).join('\n') : '- Inbox';

  return [
    'You are an assistant inside a Telegram todo bot.',
    'You can answer normally OR ask the bot to call a tool (Notion databases actions).',
    'Return STRICT JSON only (no markdown).',
    '',
    'Important:',
    '- You MAY receive chat summary and recent chat messages in the user context. Use them when the user asks "что мы обсуждали", "какое сообщение было", etc.',
    "- Do NOT claim you don't have access to chat messages/history when it is provided in context.",
    "- If the user asks to show or search chat messages, prefer instructing admin-only commands /chat_history and /chat_find (if available) instead of guessing.",
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
    '- For notion.create_task and notion.update_task: keep args.title concise (max 120 characters). Put details and context into args.description.',
    '- If the user explicitly asks to UPDATE a task and mentions status (e.g. "обнови задачу 5 статус Done"), use tool "notion.update_task" with args.status.',
    '- Use tool "notion.mark_done" when the user asks to mark a task as completed/done (e.g. "пометь выполненной", "сделай done", "заверши").',
    '- If user asks to show/list tasks (e.g., "покажи", "список", "что у меня в Notion") you MUST use tool "notion.list_tasks".',
    '- If user asks to show/list tasks AND mentions a keyword/topic (e.g. "покажи задачи про билеты", "покажи задачи купить", "список задач по слову созвон"), you STILL MUST use "notion.list_tasks" and pass args.queryText to filter by title. Do NOT use "notion.find_tasks" for show/list queries.',
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
    '- notion.list_tasks supports optional args.queryText (search inside task title). Use it for "покажи задачи про/по/с текстом/со словом X".',
    '- For categories, prefer args.tag with a value from Allowed categories.',
    '- Common RU synonyms: "домашние" -> tag "Home", "рабочие" -> tag "Work", "инбокс/входящие/today" -> tag "Inbox".',
    '- Tag inference for new tasks: analyze the task content to determine the best tag.',
    '  - Work: tasks related to job, business, projects, meetings, clients, code, deploy, servers, documentation, LinkedIn, career.',
    '  - Home: tasks related to house, apartment, furniture, repairs, cleaning, organizing, family errands, sports equipment (турник, гантели), pets.',
    '  - Personal: tasks related to health, fitness (gym), hobbies, personal development, learning, travel, self-care.',
    '  - Inbox: when unsure or the task is generic/unclear.',
    '- If user asks "задачи на сегодня" use args.preset="today" (this means dueDate = today PLUS Inbox).',
    '- For list_tasks date ranges (like "на этой неделе/на следующей неделе"), use args.dueDateOnOrAfter and args.dueDateBefore (not dateOnOrAfter/dateBefore).',
    '- Relative dates like "сегодня/завтра/послезавтра" MUST be interpreted using the provided timezone and current time in the user message context.',
    '- If the user specifies a time (e.g. "сегодня в 15:00"), set dueDate to a full ISO datetime string (YYYY-MM-DDTHH:mm:ss+HH:MM) in that timezone. Do NOT invent a different day.',
    '- If the user specifies a time range (e.g. "в 14:00 до 15:00", "с 14:00 до 15:00", "встреча 14-15"), set dueDate to the start datetime and set dueDateEnd to the end datetime (both in full ISO datetime format with timezone offset).',
    '- If user asks for completed tasks: set args.status="Done" or args.doneOnly=true.',
    '- If user asks to include completed tasks: set args.includeDone=true.',
    '- Use notion.find_tasks ONLY when user explicitly asks to find/search a task (RU: "найди", "поиск") OR when the user refers to ONE task by name without a show/list intent and you need to resolve it for a follow-up action.',
    '- If user refers by number, the bot may provide lastShownList; you can request "taskIndex" in args.',
    '- notion.create_task supports args: title, tag, dueDate, dueDateEnd, status, priority, description.',
    '- notion.update_task supports args: pageId OR queryText/taskIndex plus patch fields (title, tag, dueDate, dueDateEnd, status, priority) and may include description.',
    '',
    '- If user talks about ideas (RU: "идея", "идеи") use Ideas tools.',
    '  - list ideas: notion.list_ideas (args: category?, status?, queryText?, limit?)',
    '  - create idea: notion.create_idea (args: title, category?, status?, priority?, source?, description?)',
    '  - update idea: notion.update_idea (args: pageId OR queryText/taskIndex, and patch fields: title?, category?, status?, priority?, source?, area?, tags?, project?)',
    '  - archive idea: notion.archive_idea (args: pageId or queryText/taskIndex)',
    '',
    '- If user talks about social posts (RU: "пост", "соцсети", platform names) use Social tools.',
    '  - list posts: notion.list_social_posts (args: platform?, status?, dateOnOrAfter?, dateBefore?, queryText?, limit?)',
    '  - create post: notion.create_social_post (args: title, platform?, postDate?, contentType?, status?, postUrl?, description?)',
    '  - update post: notion.update_social_post (args: pageId OR queryText/taskIndex, and patch fields: title?, platform?, postDate?, contentType?, status?, postUrl?)',
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
  const normalizedArgs = normalizeToolArgsByToolName(name, args);
  return { type: 'tool', chat: null, tool: { name, args: normalizedArgs } };
}

async function planAgentAction({
  apiKey,
  model = 'gpt-4.1',
  userText,
  allowedCategories,
  lastShownList,
  lastShownIdeasList,
  lastShownSocialList,
  tz,
  nowIso,
  memorySummary,
  chatSummary,
  chatHistory,
  workContext,
}) {
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

  if (Array.isArray(lastShownIdeasList) && lastShownIdeasList.length) {
    ctxLines.push('');
    ctxLines.push('Last shown ideas list (index -> title):');
    for (const item of lastShownIdeasList.slice(0, 20)) {
      ctxLines.push(`${item.index}. ${item.title}`);
    }
  }

  if (Array.isArray(lastShownSocialList) && lastShownSocialList.length) {
    ctxLines.push('');
    ctxLines.push('Last shown social posts list (index -> title):');
    for (const item of lastShownSocialList.slice(0, 20)) {
      ctxLines.push(`${item.index}. ${item.title}`);
    }
  }

  const mem = String(memorySummary || '').trim();
  if (mem) {
    ctxLines.push('');
    ctxLines.push('User preferences (memory):');
    ctxLines.push(mem);
  }

  const chatSum = String(chatSummary || '').trim();
  if (chatSum) {
    ctxLines.push('');
    ctxLines.push('Chat summary:');
    ctxLines.push(chatSum);
  }

  const chatHist = String(chatHistory || '').trim();
  if (chatHist) {
    ctxLines.push('');
    ctxLines.push('Recent chat messages:');
    ctxLines.push(chatHist);
  }

  const work = String(workContext || '').trim();
  if (work) {
    ctxLines.push('');
    ctxLines.push('Work context:');
    ctxLines.push(work);
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


