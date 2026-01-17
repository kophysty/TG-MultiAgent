const {
  debugLog,
  inferListHintsFromText,
  normalizeCategoryInput,
  yyyyMmDdInTz,
  findTasksFuzzy,
  normalizeTitleKey,
  makeId,
  truncate,
  oneLinePreview,
  inferDateFromText,
  addDaysToYyyyMmDd,
  normalizeMultiOptionValue,
  pickBestOptionMatch,
  normalizeDueDateInput,
  inferDueDateFromUserText,
  inferListDueDateFromText,
  clampRating1to5,
  hasNonEmptyOptionInput,
  inferMoodEnergyFromText,
  inferJournalTypeFromText,
  inferJournalTopicsFromText,
  inferJournalContextFromText,
  isEmptyPatchObject,
  normalizeSocialPlatform,
  normalizeSocialContentType,
  normalizeSocialStatus,
  extractNotionErrorInfo,
  buildToolConfirmKeyboard,
  buildPickTaskKeyboard,
  buildPickPlatformKeyboard,
  findTasksFuzzyEnhanced,
  findIdeasFuzzyEnhanced,
  findSocialPostsFuzzyEnhanced,
  findJournalEntriesFuzzyEnhanced,
  buildMultiQueryCandidates,
  inferRequestedTaskActionFromText,
  inferIndexFromText,
  inferSocialWeekRangeFromText,
  inferTasksWeekRangeFromText,
  formatTaskCreateSummary,
  formatTaskUpdateSummary,
  formatIdeaCreateSummary,
  formatSocialPostCreateSummary,
  formatJournalEntryCreateSummary,
  splitLongTaskTitleToDescription,
} = require('./todo_bot_helpers');

const { getTraceId } = require('../runtime/trace_context');

function createToolExecutor({
  bot,
  tasksRepo,
  tasksRepoTest = null,
  getTasksBoardModeForChat = null,
  makeTasksBoardKey = null,
  ideasRepo,
  socialRepo,
  journalRepo,
  tz,
  pendingToolActionByChatId,
  lastShownListByChatId,
  lastShownIdeasListByChatId,
  lastShownSocialListByChatId,
  renderAndRememberList,
  renderAndRememberIdeasList,
  renderAndRememberSocialList,
  renderAndRememberJournalList,
  resolveJournalPageIdFromLastShown,
  eventLogRepo = null,
}) {
  async function executeToolPlan({ chatId, from, toolName, args, userText }) {
    try {
      debugLog('tool_call', { tool: toolName, chatId, from });
      if (eventLogRepo) {
        eventLogRepo
          .appendEvent({
            traceId: getTraceId() || 'no-trace',
            chatId,
            component: 'executor',
            event: 'tool_call',
            level: 'info',
            payload: { tool: toolName },
          })
          .catch(() => {});
      }

      if (toolName === 'notion.list_tasks') {
        const board = typeof getTasksBoardModeForChat === 'function' ? await getTasksBoardModeForChat(chatId) : 'main';
        const tasksRepoForChat = board === 'test' && tasksRepoTest ? tasksRepoTest : tasksRepo;
        const hinted = inferListHintsFromText(userText);
        const preset = args?.preset ? String(args.preset).trim().toLowerCase() : hinted.preset;
        const tag =
          args?.tag
            ? normalizeCategoryInput(args.tag)
            : hinted.tag
              ? normalizeCategoryInput(hinted.tag)
              : null;
        const status = args?.status ? String(args.status) : null;
        const includeDoneArg = typeof args?.includeDone === 'boolean' ? args.includeDone : null;
        const doneOnlyArg = typeof args?.doneOnly === 'boolean' ? args.doneOnly : null;
        const doneMode =
          doneOnlyArg === true
            ? 'only'
            : includeDoneArg === true
              ? 'include'
              : status && String(status).trim().toLowerCase() === 'done'
                ? 'only'
                : hinted.doneMode || 'exclude';
        let dueDate = args?.dueDate ? String(args.dueDate).trim() : null;
        const queryText = args?.queryText ? String(args.queryText) : null;

        // Week range inference (this week / next week) for list queries.
        const weekHint = inferTasksWeekRangeFromText({ userText, tz });
        let dueDateOnOrAfter = args?.dueDateOnOrAfter ? String(args.dueDateOnOrAfter).trim() : null;
        let dueDateBefore = args?.dueDateBefore ? String(args.dueDateBefore).trim() : null;
        const weekKind = weekHint?.kind || null;
        if (!dueDateOnOrAfter && !dueDateBefore && weekHint?.dateOnOrAfter && weekHint?.dateBefore) {
          dueDateOnOrAfter = weekHint.dateOnOrAfter;
          dueDateBefore = weekHint.dateBefore;
        }

        if (dueDate) {
          const low = dueDate.toLowerCase();
          if (low === 'today' || low === 'сегодня') dueDate = yyyyMmDdInTz({ tz });
          if (low === 'tomorrow' || low === 'завтра') dueDate = addDaysToYyyyMmDd(yyyyMmDdInTz({ tz }), 1);
          if (low === 'day after tomorrow' || low === 'послезавтра') dueDate = addDaysToYyyyMmDd(yyyyMmDdInTz({ tz }), 2);
        }

        // If user asked "на завтра/на 8-е" but the model didn't pass dueDate, infer from the message.
        if (!dueDate && !queryText) {
          const inferredListDate = inferListDueDateFromText({ userText, tz });
          if (inferredListDate) dueDate = inferredListDate;
        }

        let tasks = [];
        if (preset === 'today') {
          const today = yyyyMmDdInTz({ tz });
          const queryStatus = doneMode === 'only' ? 'Done' : null;
          if (tag) {
            tasks = await tasksRepoForChat.listTasks({ tag, dueDate: today, status: queryStatus, limit: 100 });
          } else {
            const byDate = await tasksRepoForChat.listTasks({ dueDate: today, status: queryStatus, limit: 100 });
            const inbox = await tasksRepoForChat.listTasks({ tag: 'Inbox', status: queryStatus, limit: 100 });
            // For "today" preset: include Inbox only if it has no due date or is due today or earlier (overdue).
            // This prevents "tasks for today" from showing future-dated Inbox items (like due tomorrow).
            const inboxFiltered = (inbox || []).filter((t) => !t?.dueDate || String(t.dueDate).slice(0, 10) <= today);
            const seen = new Set();
            for (const x of [...byDate, ...inboxFiltered]) {
              if (!x || !x.id) continue;
              if (seen.has(x.id)) continue;
              seen.add(x.id);
              tasks.push(x);
            }
          }
        } else {
          // Support presets for tomorrow/day after tomorrow by converting to dueDate.
          if (!dueDate && preset === 'tomorrow') dueDate = addDaysToYyyyMmDd(yyyyMmDdInTz({ tz }), 1);
          if (!dueDate && preset === 'day_after_tomorrow') dueDate = addDaysToYyyyMmDd(yyyyMmDdInTz({ tz }), 2);
          const queryStatus = status || (doneMode === 'only' ? 'Done' : null);

          if (dueDateOnOrAfter || dueDateBefore) {
            // Week-style list: include all tasks with due dates in range PLUS all Inbox tasks (even without date).
            const byRange = await tasksRepoForChat.listTasks({
              tag,
              status: queryStatus,
              dueDateOnOrAfter: dueDateOnOrAfter || null,
              dueDateBefore: dueDateBefore || null,
              queryText,
              limit: 100,
            });
            const shouldIncludeInbox = !tag || String(tag).toLowerCase() === 'inbox';
            const inbox = shouldIncludeInbox ? await tasksRepoForChat.listTasks({ tag: 'Inbox', status: queryStatus, limit: 100 }) : [];
            const withinRange = (ymd) => {
              if (!ymd) return false;
              const d = String(ymd).slice(0, 10);
              if (dueDateOnOrAfter && d < String(dueDateOnOrAfter)) return false;
              if (dueDateBefore && d >= String(dueDateBefore)) return false;
              return true;
            };
            const inboxFiltered = (inbox || []).filter((t) => !t?.dueDate || withinRange(t.dueDate));
            const seen = new Set();
            for (const x of [...(byRange || []), ...(inboxFiltered || [])]) {
              if (!x || !x.id) continue;
              if (seen.has(x.id)) continue;
              seen.add(x.id);
              tasks.push(x);
            }
          } else {
            tasks = await tasksRepoForChat.listTasks({ tag, status: queryStatus, dueDate, queryText, limit: 100 });
          }
        }

        let filtered = tasks.filter((t) => !t.tags.includes('Deprecated'));

        if (doneMode === 'exclude') {
          filtered = filtered.filter((t) => String(t.status || '').trim().toLowerCase() !== 'done');
        } else if (doneMode === 'only') {
          filtered = filtered.filter((t) => String(t.status || '').trim().toLowerCase() === 'done');
        } else {
          // include -> do nothing
        }

        const titleBase = doneMode === 'only' ? 'Твои выполненные задачи:' : 'Твои задачи:';
        const title =
          weekKind === 'this_week'
            ? `${titleBase} (на этой неделе)`
            : weekKind === 'next_week'
              ? `${titleBase} (на следующей неделе)`
              : titleBase;
        await renderAndRememberList({ chatId, tasks: filtered, title, board });
        return;
      }

      if (toolName === 'notion.find_tasks') {
        const board = typeof getTasksBoardModeForChat === 'function' ? await getTasksBoardModeForChat(chatId) : 'main';
        const tasksRepoForChat = board === 'test' && tasksRepoTest ? tasksRepoTest : tasksRepo;
        const queryText = String(args?.queryText || '').trim();
        const { tasks, source } = await findTasksFuzzyEnhanced({ notionRepo: tasksRepoForChat, queryText, limit: 20 });
        const filtered = tasks.filter((t) => !t.tags.includes('Deprecated'));
        const inferredAction = inferRequestedTaskActionFromText(userText);

        // If the user asked to delete/done in the same message, do not ask again.
        if (inferredAction === 'move_to_deprecated') {
          const parts = buildMultiQueryCandidates(userText);
          const t = String(userText || '').toLowerCase();
          const andCount = (t.match(/\sи\s/g) || []).length;
          const wantsMany =
            /(удали|убери|delete|remove)/.test(t) &&
            ((/удали\s+их|убери\s+их/.test(t)) ||
              (/(задач(и|ами|ах|ам)|tasks\b)/i.test(t)) ||
              andCount >= 2 ||
              parts.length > 1);

          // If the message suggests multiple tasks, try to find multiple matches by the whole sentence.
          // This handles voice cases where separators are missing between titles.
          let multiFound = null;
          if (wantsMany) {
            try {
              const all = await findTasksFuzzyEnhanced({ notionRepo: tasksRepoForChat, queryText: userText, limit: 10 });
              const allFiltered = (all.tasks || []).filter((x) => !x?.tags?.includes('Deprecated'));
              if (allFiltered.length > 1) multiFound = allFiltered;
            } catch {
              multiFound = null;
            }
          }

          // Keep queue for multi-delete; remove the current queryText from queue when possible.
          const qKey = normalizeTitleKey(queryText);
          const queue = [];
          if (Array.isArray(multiFound) && multiFound.length > 1) {
            // Use exact titles as queue entries (safer than parsing raw text).
            for (const it of multiFound) {
              const title = String(it?.title || '').trim();
              if (!title) continue;
              // Skip the first chosen candidate, will be set below
              // (we keep all titles here and later slice based on chosen id).
              if (!queue.includes(title)) queue.push(title);
              if (queue.length >= 10) break;
            }
          } else if (parts.length > 1) {
            for (const p of parts) {
              const k = normalizeTitleKey(p);
              if (!k) continue;
              // Drop exact and near-duplicate variants (e.g. "автоматик" vs "автоматика")
              if (k === qKey) continue;
              if (qKey && (k.startsWith(qKey) || qKey.startsWith(k))) continue;
              if (!queue.includes(p)) queue.push(p);
              if (queue.length >= 9) break;
            }
          }

          if (!filtered.length) {
            bot.sendMessage(chatId, `По "${queryText}" ничего не нашел. Уточни название.`);
            return;
          }
          if (filtered.length === 1) {
            const chosen = filtered[0];
            // If queue was constructed from multiFound titles, drop chosen title from queue.
            const chosenTitleKey = normalizeTitleKey(String(chosen.title || ''));
            const nextQueue = queue
              .filter((q) => normalizeTitleKey(q) !== chosenTitleKey)
              .slice(0, 9);
            const actionId = makeId(`${chatId}:${Date.now()}:notion.move_to_deprecated:${chosen.id}`);
            pendingToolActionByChatId.set(chatId, {
              id: actionId,
              kind: 'notion.move_to_deprecated',
              payload: { pageId: chosen.id, _queueQueries: nextQueue.length ? nextQueue : undefined, _board: board },
              createdAt: Date.now(),
            });
            bot.sendMessage(
              chatId,
              [`Нашел задачу: "${chosen.title}".`, 'Перенести задачу в Deprecated?'].join('\n'),
              buildToolConfirmKeyboard({ actionId })
            );
            return;
          }
          const items = filtered.slice(0, 10).map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, {
            id: null,
            kind: 'notion.move_to_deprecated',
            payload: { _candidates: items, _queueQueries: queue.length ? queue : undefined, _board: board },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Нашел несколько задач для удаления. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }

        const suffix = source === 'local' ? ' (локальный fuzzy)' : '';
        await renderAndRememberList({ chatId, tasks: filtered, title: `Найдено по "${queryText}":${suffix}`, board });
        return;
      }

      if (toolName === 'notion.create_task') {
        const board = typeof getTasksBoardModeForChat === 'function' ? await getTasksBoardModeForChat(chatId) : 'main';
        const tasksRepoForChat = board === 'test' && tasksRepoTest ? tasksRepoTest : tasksRepo;
        const { status: statusOptions, priority: priorityOptions } = await tasksRepoForChat.getOptions();

        const rawTitle = String(args?.title || '').trim();
        const tag = args?.tag ? normalizeCategoryInput(args.tag) : null;
        const rawPriority = args?.priority ? String(args.priority) : null;
        const priority = pickBestOptionMatch({ input: rawPriority, options: priorityOptions }).value || null;
        const inferredDue = inferDueDateFromUserText({ userText, tz });
        const dueDate = inferredDue || (args?.dueDate ? normalizeDueDateInput({ dueDate: String(args.dueDate), tz }) : null);
        const rawStatus = args?.status ? String(args.status) : 'Idle';
        const status = pickBestOptionMatch({ input: rawStatus, options: statusOptions }).value || undefined;
        const rawDescription = args?.description ? String(args.description) : null;
        const split = splitLongTaskTitleToDescription({ title: rawTitle, description: rawDescription, maxTitleLen: 120 });
        const title = split.title;
        const description = split.description;

        // Dedup check: if a similar active task exists, ask before creating a duplicate.
        const key = normalizeTitleKey(title);
        const candidates = (await tasksRepoForChat.findTasks({ queryText: title, limit: 10 })).filter((t) => !t.tags.includes('Deprecated'));
        const dupe = candidates.find((t) => normalizeTitleKey(t.title) === key);
        if (dupe) {
          const actionId = makeId(`${chatId}:${Date.now()}:notion.create_task:${key}`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'notion.create_task',
            payload: { title, tag, priority, dueDate, status, description, _board: board },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, `Похоже, такая задача уже есть: "${dupe.title}". Создать дубль?`, buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const created = await tasksRepoForChat.createTask({ title, tag, priority, dueDate, status });
        if (description) await tasksRepoForChat.appendDescription({ pageId: created.id, text: description });
        bot.sendMessage(chatId, formatTaskCreateSummary({ created, board }));
        return;
      }

      if (toolName === 'notion.list_ideas') {
        const queryText = args?.queryText ? String(args.queryText) : null;
        const status = args?.status ? String(args.status) : null;
        const category = args?.category ? args.category : null;
        const limit = args?.limit ? Number(args.limit) : 15;
        const ideas = await ideasRepo.listIdeas({ category, status, queryText, limit });
        await renderAndRememberIdeasList({ chatId, ideas, title: 'Идеи:' });
        return;
      }

      if (toolName === 'notion.find_ideas') {
        const queryText = String(args?.queryText || '').trim();
        const { items, source } = await findIdeasFuzzyEnhanced({ ideasRepo, queryText, limit: 20 });
        const suffix = source === 'local' ? ' (локальный fuzzy)' : '';
        await renderAndRememberIdeasList({ chatId, ideas: items, title: `Найдено по "${queryText}":${suffix}` });
        return;
      }

      if (toolName === 'notion.create_idea') {
        const title = String(args?.title || '').trim();
        const rawStatus = args?.status !== undefined && args?.status !== null ? String(args.status).trim() : '';
        const rawPriority = args?.priority !== undefined && args?.priority !== null ? String(args.priority).trim() : '';
        let category = args?.category ?? null; // string|array|null
        const source = args?.source ? String(args.source) : undefined;
        const description = args?.description ? String(args.description) : null;

        // Prevent creating new Category options: match only against existing Notion options.
        // Also infer Category/Area/Tags from context when missing or when the model picks generic buckets.
        const { category: categoryOptions, area: areaOptions, tags: tagOptions, status: statusOptions, priority: priorityOptions, areaType } = await ideasRepo.getOptions();

        // Status/Priority must match existing Notion options. If unknown or options are missing, do not send the field.
        const pickStrictOption = (input, options) => {
          const s = String(input || '').trim();
          const opts = Array.isArray(options) ? options.filter(Boolean) : [];
          if (!s) return undefined;
          if (!opts.length) return undefined;
          const r = pickBestOptionMatch({ input: s, options: opts, aliases: null });
          if (r.unknown) return undefined;
          return r.value || undefined;
        };
        const status = rawStatus ? pickStrictOption(rawStatus, statusOptions) : undefined;
        const priority = rawPriority ? pickStrictOption(rawPriority, priorityOptions) : undefined;

        const baseText = [title, description, String(userText || '')].filter(Boolean).join('\n').toLowerCase();
        const wantsInboxExplicitly = /(в\s+инбокс|входящ|инбокс|inbox)/.test(baseText);

        const IDEAS_CATEGORY_ALIASES = {
          inbox: 'inbox',
          инбокс: 'inbox',
          входящие: 'inbox',
          входящ: 'inbox',
          research: 'research',
          ресерч: 'research',
          исследование: 'research',
          исслед: 'research',
          quote: 'quote',
          thought: 'quote',
          цитата: 'quote',
          цитат: 'quote',
          мысль: 'quote',
          problem: 'problem',
          insight: 'problem',
          проблема: 'problem',
          проблем: 'problem',
          инсайт: 'problem',
          work: 'work',
          работа: 'work',
          рабоч: 'work',
          concept: 'concept',
          концепт: 'concept',
          идея: 'concept',
          продукт: 'concept',
          фича: 'concept',
          feature: 'concept',
          разработка: 'concept',
          разработ: 'concept',
          миниапка: 'concept',
          приложение: 'concept',
          прилож: 'concept',
          бот: 'concept',
        };

        const inferCategoryCandidate = () => {
          if (wantsInboxExplicitly) return 'inbox';
          if (/(исслед|research|ресерч)/.test(baseText)) return 'исследование';
          if (/(цитат|quote|thought|мысл)/.test(baseText)) return 'цитата';
          if (/(проблем|insight|инсайт)/.test(baseText)) return 'insight';
          if (/(работ|work)/.test(baseText)) return 'work';
          if (/(идея|концепт|продукт|фича|feature|разработ|код|апк|прилож|бот)/.test(baseText)) return 'concept';
          return 'concept';
        };

        const inferAreaCandidate = () => {
          if (/(разработ|dev|код|api|бот|прилож|апк|ui|ux|таблич)/.test(baseText)) return 'dev';
          if (/(продукт|product|growth|фича|feature|roadmap)/.test(baseText)) return 'product';
          if (/(контент|content|пост|соцсет|smm)/.test(baseText)) return 'content';
          if (/(деньг|финанс|revenue|монетиз)/.test(baseText)) return 'finance';
          if (/(здоров|сон|спорт|трен)/.test(baseText)) return 'health';
          if (/(семь|отношен|relationship)/.test(baseText)) return 'relationships';
          if (/(стартап|startup|бизнес|предприним|клиент|продаж|сервис|ремонт|услуг)/.test(baseText)) return 'business';
          return null;
        };

        const inferTagsCandidates = () => {
          const out = [];
          const push = (x) => {
            const s = String(x || '').trim();
            if (!s) return;
            if (!out.includes(s)) out.push(s);
          };
          if (/(разработ|dev|код|api|бот|прилож|апк|ui|ux|таблич)/.test(baseText)) push('Dev');
          if (/(продукт|product|growth|фича|feature|roadmap)/.test(baseText)) push('Product');
          if (/(контент|content|пост|соцсет|smm)/.test(baseText)) push('Content');
          return out.slice(0, 2);
        };

        // Category: if missing OR model used generic Inbox without explicit request, infer from context.
        if (category === null || category === undefined) {
          const hint = inferCategoryCandidate();
          const best = pickBestOptionMatch({ input: hint, options: categoryOptions, aliases: IDEAS_CATEGORY_ALIASES });
          if (best.value) category = best.value;
        } else {
          const rawCategory = Array.isArray(category) ? category[0] : category;
          const rawKey = String(rawCategory || '').trim().toLowerCase();
          const pickedInbox = /(inbox)/.test(rawKey) || /(инбокс)/.test(rawKey);
          if (pickedInbox && !wantsInboxExplicitly) {
            const hint = inferCategoryCandidate();
            const best = pickBestOptionMatch({ input: hint, options: categoryOptions, aliases: IDEAS_CATEGORY_ALIASES });
            if (best.value) category = best.value;
          }
        }

        // Area: prefer matching to existing options when Area is select/multi_select; if rich_text - allow free-form.
        const AREA_CANONICAL = {
          dev: 'Dev',
          product: 'Product',
          content: 'Content',
          finance: 'Finance',
          health: 'Health',
          relationships: 'Relationships',
          business: 'Business',
        };

        const resolveAreaName = async (rawInput) => {
          const raw = String(rawInput || '').trim();
          if (!raw) return null;

          // 1) Try match against existing options
          if (Array.isArray(areaOptions) && areaOptions.length) {
            const best = pickBestOptionMatch({ input: raw, options: areaOptions, aliases: null });
            if (best.value) return best.value;
          }

          // 2) If Area is select/multi_select and option missing, create it (no dupes).
          if ((areaType === 'select' || areaType === 'multi_select') && typeof ideasRepo.ensureAreaOptions === 'function') {
            const r = await ideasRepo.ensureAreaOptions({ desiredNames: [raw] });
            const resolved = Array.isArray(r?.resolved) && r.resolved.length ? r.resolved[0] : raw;
            if (Array.isArray(areaOptions)) areaOptions.push(resolved);
            return resolved;
          }

          // 3) For rich_text - allow free form.
          if (areaType === 'rich_text') return raw;
          return null;
        };

        let area = args?.area !== undefined ? String(args.area || '').trim() : '';
        if (!area) {
          const hint = inferAreaCandidate();
          const desired = hint ? AREA_CANONICAL[hint] || hint : '';
          if (desired) area = (await resolveAreaName(desired)) || '';
        } else {
          area = (await resolveAreaName(area)) || '';
        }
        if (!area) area = undefined;

        // Tags: only match existing tags options, never create new.
        let tags = args?.tags !== undefined ? args.tags : undefined;
        if (tags === undefined) {
          const hints = inferTagsCandidates();
          if (Array.isArray(tagOptions) && tagOptions.length && hints.length) {
            const norm = normalizeMultiOptionValue({ value: hints, options: tagOptions, aliases: null });
            tags = norm.value?.length ? norm.value : undefined;
          }
        } else if (tags !== null && tags !== undefined) {
          const norm = normalizeMultiOptionValue({ value: tags, options: tagOptions, aliases: null });
          tags = norm.value?.length ? norm.value : undefined;
        }
        if (category !== null && category !== undefined) {
          const norm = normalizeMultiOptionValue({ value: category, options: categoryOptions, aliases: null });
          if (norm.unknown.length) {
            // If we cannot match, prefer leaving empty rather than creating a new option.
            const concept = (categoryOptions || []).find((c) => String(c).trim().toLowerCase() === 'concept') || null;
            category = concept ? concept : null;
          } else {
            category = Array.isArray(category) ? norm.value : norm.value[0] || null;
          }
        }

        const key = normalizeTitleKey(title);
        const candidates = await ideasRepo.listIdeas({ queryText: title, limit: 10 });
        const dupe = candidates.find((t) => normalizeTitleKey(t.title) === key);
        if (dupe) {
          const actionId = makeId(`${chatId}:${Date.now()}:notion.create_idea:${key}`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'notion.create_idea',
            payload: { title, status, priority, category, source, area, tags, description },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, `Похоже, такая идея уже есть: "${dupe.title}". Создать дубль?`, buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const created = await ideasRepo.createIdea({ title, status, priority, category, source, area, tags });
        if (description) await ideasRepo.appendDescription({ pageId: created.id, text: description });
        bot.sendMessage(chatId, formatIdeaCreateSummary({ created }));
        return;
      }

      if (toolName === 'notion.update_idea') {
        const { category: categoryOptions, tags: tagOptions, area: areaOptions, project: projectOptions, status: statusOptions, priority: priorityOptions } = await ideasRepo.getOptions();
        let normCategory = args?.category !== undefined ? args.category : undefined;
        if (normCategory !== undefined && normCategory !== null) {
          const norm = normalizeMultiOptionValue({ value: normCategory, options: categoryOptions, aliases: null });
          if (norm.unknown.length) {
            // Unknown category: do not change existing value (avoid clearing by mistake).
            normCategory = undefined;
          } else {
            normCategory = Array.isArray(normCategory) ? norm.value : norm.value[0] || null;
          }
        }

        // Status/Priority normalization
        let normStatus = args?.status !== undefined ? args.status : undefined;
        if (normStatus !== undefined && normStatus !== null) {
          const opts = Array.isArray(statusOptions) ? statusOptions.filter(Boolean) : [];
          if (!opts.length) normStatus = undefined;
          else {
            const norm = pickBestOptionMatch({ input: normStatus, options: opts, aliases: null });
            normStatus = norm.unknown ? undefined : norm.value || undefined;
          }
        }

        let normPriority = args?.priority !== undefined ? args.priority : undefined;
        if (normPriority !== undefined && normPriority !== null) {
          const opts = Array.isArray(priorityOptions) ? priorityOptions.filter(Boolean) : [];
          if (!opts.length) normPriority = undefined;
          else {
            const norm = pickBestOptionMatch({ input: normPriority, options: opts, aliases: null });
            normPriority = norm.unknown ? undefined : norm.value || undefined;
          }
        }

        // Tags:
        // - Default behavior: "поставь/установи теги X" should ADD (merge) rather than overwrite,
        //   unless user explicitly asks to REPLACE.
        // - "добавь тег" must also count as merge (previous regex missed "добавь").
        const textForTags = String(userText || '');
        const wantsReplaceTags =
          /(замен(и|ить|ите)|перезапис(ать|ать\s+все)?|перепиш(и|ите)|очист(и|ить|ите)|сброс(и|ить|ите)|удал(и|ить|ите)\s+все\s+тег)/i.test(textForTags) ||
          /(только\s+эти\s+тег|остав(ь|ьте)\s+только\s+тег)/i.test(textForTags);
        const mentionsTag = /(тег)/i.test(textForTags);
        const wantsMergeTags = !wantsReplaceTags;
        let normTags = args?.tags !== undefined ? args.tags : args?.tag !== undefined ? args.tag : undefined;
        if (normTags !== undefined && normTags !== null) {
          const norm = normalizeMultiOptionValue({ value: normTags, options: tagOptions, aliases: null });
          if (norm.unknown.length) {
            // Allow creating new tag options only when user explicitly mentions tags in text
            // (avoid creating options from accidental AI guesses).
            if (mentionsTag && typeof ideasRepo.ensureTagsOptions === 'function') {
              const ensured = await ideasRepo.ensureTagsOptions({ desiredNames: norm.unknown });
              const merged = Array.from(new Set([...(norm.value || []), ...(ensured.resolved || [])]));
              normTags = merged;
            } else {
              normTags = undefined;
            }
          } else {
            normTags = Array.isArray(normTags) ? norm.value : norm.value[0] ? [norm.value[0]] : [];
          }
        }

        // Area: accept args.area if provided, best-effort match (options are dynamic).
        let normArea = args?.area !== undefined ? args.area : undefined;
        if (normArea !== undefined && normArea !== null) {
          const norm = pickBestOptionMatch({ input: normArea, options: areaOptions, aliases: null });
          normArea = norm.value || String(normArea || '').trim() || undefined;
        }

        // Project: accept args.project, match existing options or create if needed (explicit "проект").
        const wantsProject = /(проект)/i.test(String(userText || ''));
        let normProject = args?.project !== undefined ? args.project : undefined;
        if (normProject !== undefined && normProject !== null) {
          const norm = pickBestOptionMatch({ input: normProject, options: projectOptions, aliases: null });
          if (!norm.value) {
            if (wantsProject && typeof ideasRepo.ensureProjectOptions === 'function') {
              const ensured = await ideasRepo.ensureProjectOptions({ desiredNames: [String(normProject)] });
              normProject = ensured.resolved?.[0] || String(normProject || '').trim() || undefined;
            } else {
              normProject = undefined;
            }
          } else {
            normProject = norm.value;
          }
        }

        const patch = {
          title: args?.title ? String(args.title) : undefined,
          status: normStatus,
          priority: normPriority,
          category: normCategory,
          tags: normTags,
          area: normArea !== undefined ? (normArea === null ? null : String(normArea)) : undefined,
          project: normProject !== undefined ? (normProject === null ? null : String(normProject)) : undefined,
          source: args?.source !== undefined ? String(args.source) : undefined,
        };
        // resolve pageId via shared logic below
        // Note: merge affects only tags updates. For null (clear) we must not merge.
        const mergeTags = normTags !== undefined && normTags !== null ? Boolean(wantsMergeTags) : false;
        args = { ...args, _patch: patch, _mergeTags: mergeTags };
        toolName = 'notion.update_idea_resolve';
      }

      if (toolName === 'notion.archive_idea') {
        toolName = 'notion.archive_idea_resolve';
      }

      if (toolName === 'notion.list_social_posts') {
        const queryText = args?.queryText ? String(args.queryText) : null;
        const rawStatus = args?.status ? String(args.status) : null;
        const rawPlatform = args?.platform ?? null;
        const limit = args?.limit ? Number(args.limit) : 15;

        const { platform: platforms, status: statuses } = await socialRepo.getOptions();
        const status =
          Array.isArray(statuses) && statuses.length
            ? normalizeSocialStatus({ status: rawStatus, statuses }).value
            : null;
        const normPlatform = normalizeSocialPlatform({ platform: rawPlatform, platforms });
        if (!normPlatform.ok) {
          const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform_list`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'social.pick_platform_list',
            payload: { draft: { queryText, status, limit }, platforms },
            createdAt: Date.now(),
          });
          const msg = hasNonEmptyOptionInput(rawPlatform)
            ? 'Не вижу такую платформу среди доступных. Выбери из списка:'
            : 'Выбери платформу для списка:';
          bot.sendMessage(chatId, msg, buildPickPlatformKeyboard({ actionId, platforms }));
          return;
        }

        const text = String(userText || '').toLowerCase();

        // Date range inference for schedule-style requests:
        // - "на этой неделе" => today..next Monday (exclusive)
        // - "на завтра/на число" => specific day range [date, date+1)
        let dateOnOrAfter = args?.dateOnOrAfter ? String(args.dateOnOrAfter) : null;
        let dateBefore = args?.dateBefore ? String(args.dateBefore) : null;

        if (!dateOnOrAfter && !dateBefore) {
          const wk = inferSocialWeekRangeFromText({ userText, tz });
          if (wk?.dateOnOrAfter && wk?.dateBefore) {
            dateOnOrAfter = wk.dateOnOrAfter;
            dateBefore = wk.dateBefore;
          }
        }

        if (!dateOnOrAfter && !dateBefore) {
          const day = inferListDueDateFromText({ userText, tz });
          if (day) {
            dateOnOrAfter = day;
            dateBefore = addDaysToYyyyMmDd(day, 1);
          }
        }

        // If user asks for "posts to publish" or provides a date/week, filter out posts without date and already finished ones.
        const isScheduleQuery =
          Boolean(dateOnOrAfter || dateBefore) ||
          /(должен|надо)\s+(опубликовать|публиковать|запостить|постить)/.test(text) ||
          /(на\s+этой\s+неделе|до\s+конца\s+недел)/.test(text) ||
          /(на\s+завтра|послезавтра|tomorrow)/.test(text);

        const wantsPublished = /(опубликован|published)/.test(text);
        const wantsCancelled = /(отменен|отменён|cancelled)/.test(text);
        const excludeStatuses =
          !status && isScheduleQuery
            ? ['Published', 'Cancelled'].filter((s) => (s === 'Published' ? !wantsPublished : s === 'Cancelled' ? !wantsCancelled : true))
            : null;
        const requireDate = Boolean(isScheduleQuery);

        debugLog('social_list_schedule_query', {
          chatId,
          isScheduleQuery,
          dateOnOrAfter,
          dateBefore,
          requireDate,
          excludeStatuses,
          platform: normPlatform.value,
          status,
          queryText,
        });

        const queryLimit = isScheduleQuery ? Math.max(30, Math.min(100, limit * 4)) : limit;

        let posts = [];
        try {
          posts = await socialRepo.listPosts({
            platform: normPlatform.value,
            status,
            excludeStatuses,
            requireDate,
            dateOnOrAfter,
            dateBefore,
            queryText,
            limit: queryLimit,
          });
        } catch (e) {
          // Fallback: if Notion filter operators differ for status/date, retry without advanced filters
          // and apply filtering locally.
          debugLog('social_list_retry_without_advanced_filters', { message: String(e?.message || e) });
          posts = await socialRepo.listPosts({
            platform: normPlatform.value,
            status,
            dateOnOrAfter,
            dateBefore,
            queryText,
            limit: queryLimit,
          });
        }

        // Always apply strict filtering locally for schedule-style queries:
        // - hide Published/Cancelled by default
        // - require Post date
        if (isScheduleQuery) {
          const excl = Array.isArray(excludeStatuses) ? excludeStatuses.map((x) => String(x || '').toLowerCase()) : [];
          posts = (posts || [])
            .filter((p) => p && p.postDate)
            .filter((p) => {
              if (!excl.length) return true;
              const st = String(p.status || '').toLowerCase();
              return !excl.includes(st);
            });

          // Enforce the computed date range locally too (defense-in-depth).
          // postDate may be YYYY-MM-DD or full ISO datetime; compare by YYYY-MM-DD prefix.
          const fromYmd = dateOnOrAfter ? String(dateOnOrAfter).slice(0, 10) : null;
          const beforeYmd = dateBefore ? String(dateBefore).slice(0, 10) : null;
          if (fromYmd || beforeYmd) {
            posts = posts.filter((p) => {
              const ymd = String(p.postDate || '').slice(0, 10);
              if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
              if (fromYmd && ymd < fromYmd) return false;
              if (beforeYmd && ymd >= beforeYmd) return false;
              return true;
            });
          }
        }

        const title = isScheduleQuery ? 'Посты (к публикации):' : 'Посты (Social Media Planner):';
        await renderAndRememberSocialList({ chatId, posts: posts || [], title });
        return;
      }

      if (toolName === 'notion.find_social_posts') {
        const queryText = String(args?.queryText || '').trim();
        const { items, source } = await findSocialPostsFuzzyEnhanced({ socialRepo, queryText, limit: 20 });
        const suffix = source === 'local' ? ' (локальный fuzzy)' : '';
        await renderAndRememberSocialList({ chatId, posts: items, title: `Найдено по "${queryText}":${suffix}` });
        return;
      }

      if (toolName === 'notion.create_social_post') {
        const title = String(args?.title || '').trim();
        let platform = args?.platform !== undefined ? args.platform : undefined; // string|array|null|undefined
        const postDate = args?.postDate !== undefined && args?.postDate !== null ? String(args.postDate) : undefined;
        const contentType = args?.contentType !== undefined ? args.contentType : undefined;
        const rawStatus = args?.status !== undefined && args?.status !== null ? String(args.status).trim() : '';
        const postUrl = args?.postUrl !== undefined && args?.postUrl !== null ? String(args.postUrl) : undefined;
        const description = args?.description ? String(args.description) : null;

        const { platform: platforms, status: statuses, contentType: contentTypes, platformType } = await socialRepo.getOptions();

        const pickDefaultSocialPlatform = () => {
          const opts = Array.isArray(platforms) ? platforms.filter(Boolean) : [];
          if (!opts.length) return null;
          const byKeys = ['tg', 'telegram', 'телеграм'];
          for (const k of byKeys) {
            const hit = opts.find((o) => normalizeOptionKey(o) === normalizeOptionKey(k));
            if (hit) return hit;
          }
          const hit2 = opts.find((o) => {
            const key = normalizeOptionKey(o);
            return key.includes('telegram') || key.includes('телеграм') || key === 'tg' || key.includes('tg');
          });
          return hit2 || opts[0] || null;
        };

        const pickDefaultSocialStatus = () => {
          const opts = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
          if (!opts.length) return undefined;
          const preferred = ['Post Idea', 'Idea', 'Draft', 'Planned'];
          for (const x of preferred) {
            const hit = opts.find((o) => String(o).toLowerCase() === String(x).toLowerCase());
            if (hit) return hit;
          }
          return opts[0];
        };

        const normalizedStatus =
          Array.isArray(statuses) && statuses.length
            ? (rawStatus ? normalizeSocialStatus({ status: rawStatus, statuses }).value : null) || pickDefaultSocialStatus()
            : undefined;
        const normalizedContentType = normalizeSocialContentType({ contentType, contentTypes }).value;
        const inferredDate = !postDate ? inferDateFromText({ userText, tz }) : null;
        const effectivePostDate = postDate || inferredDate || undefined;

        if (!platform || (Array.isArray(platform) && !platform.length)) {
          const def = pickDefaultSocialPlatform();
          if (!def) {
            const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform`);
            pendingToolActionByChatId.set(chatId, {
              id: actionId,
              kind: 'social.pick_platform',
              payload: {
                draft: { title, postDate: effectivePostDate, contentType: normalizedContentType, status: normalizedStatus, postUrl, description },
                platforms,
              },
              createdAt: Date.now(),
            });
            bot.sendMessage(chatId, 'Выбери платформу для поста:', buildPickPlatformKeyboard({ actionId, platforms }));
            return;
          }
          // Default platform: TG (or the best match in Notion options).
          platform = def;
        }

        const normPlatform = normalizeSocialPlatform({ platform, platforms });
        if (!normPlatform.ok) {
          const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'social.pick_platform',
            payload: {
              draft: { title, postDate: effectivePostDate, contentType: normalizedContentType, status: normalizedStatus, postUrl, description },
              platforms,
            },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Не вижу такую платформу среди доступных. Выбери из списка:', buildPickPlatformKeyboard({ actionId, platforms }));
          return;
        }

        // If Platform is select but model returned multiple values, ask to pick one.
        if (platformType === 'select' && Array.isArray(normPlatform.value) && normPlatform.value.length > 1) {
          const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'social.pick_platform',
            payload: {
              draft: { title, postDate: effectivePostDate, contentType: normalizedContentType, status: normalizedStatus, postUrl, description },
              platforms,
            },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Платформа выбрана не однозначно. Выбери одну:', buildPickPlatformKeyboard({ actionId, platforms }));
          return;
        }

        const key = normalizeTitleKey(title);
        const candidates = await socialRepo.listPosts({ queryText: title, limit: 10 });
        const dupe = candidates.find((t) => normalizeTitleKey(t.title) === key);
        if (dupe) {
          const actionId = makeId(`${chatId}:${Date.now()}:notion.create_social_post:${key}`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'notion.create_social_post',
            payload: {
              title,
              platform: normPlatform.value,
              postDate: effectivePostDate,
              contentType: normalizedContentType,
              status: normalizedStatus,
              postUrl,
              description,
            },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, `Похоже, такой пост уже есть: "${dupe.title}". Создать дубль?`, buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const created = await socialRepo.createPost({
          title,
          platform: normPlatform.value,
          postDate: effectivePostDate,
          contentType: normalizedContentType,
          status: normalizedStatus,
          postUrl,
        });
        if (description) await socialRepo.appendDescription({ pageId: created.id, text: description });
        bot.sendMessage(chatId, formatSocialPostCreateSummary({ created }));
        return;
      }

      if (toolName === 'notion.list_journal_entries') {
        if (!journalRepo) {
          bot.sendMessage(chatId, 'Journal база не подключена. Добавь NOTION_JOURNAL_DB_ID.');
          return;
        }

        const t = String(userText || '').toLowerCase();
        const wantsLatest = /(последн|сам(ая|ый|ую)\s+последн|свеж(ая|ий|ую))/i.test(t);

        const queryText = args?.queryText ? String(args.queryText) : null;
        const rawType = args?.type !== undefined ? args.type : null;
        const rawTopics = args?.topics !== undefined ? args.topics : null;
        const rawContext = args?.context !== undefined ? args.context : null;
        let limit = args?.limit ? Number(args.limit) : 15;
        if (!args?.limit && wantsLatest) limit = 1;

        let dateOnOrAfter = args?.dateOnOrAfter ? String(args.dateOnOrAfter) : null;
        let dateBefore = args?.dateBefore ? String(args.dateBefore) : null;

        // If user talks about "today" and no explicit range is provided, list entries for today.
        if (!dateOnOrAfter && !dateBefore) {
          const inferred = inferDateFromText({ userText, tz });
          if (inferred) {
            dateOnOrAfter = inferred;
            // exclusive upper bound: next day of inferred date
            dateBefore = addDaysToYyyyMmDd(inferred, 1);
          }
        }

        // For listing: do not create new options. If filters don't match existing options, Notion will just return an empty list.
        const finalType = rawType && hasNonEmptyOptionInput(rawType) ? String(rawType).trim() : null;
        const finalTopics =
          rawTopics && hasNonEmptyOptionInput(rawTopics) ? (Array.isArray(rawTopics) ? rawTopics : [rawTopics]) : null;
        const finalContext =
          rawContext && hasNonEmptyOptionInput(rawContext) ? (Array.isArray(rawContext) ? rawContext : [rawContext]) : null;

        let entries = await journalRepo.listEntries({
          type: finalType || null,
          topics: finalTopics || null,
          context: finalContext || null,
          dateOnOrAfter: dateOnOrAfter || null,
          dateBefore: dateBefore || null,
          queryText,
          limit,
        });

        // Voice/STT noise often ends up in queryText (e.g. "в минитемп").
        // If user asked for "latest" and the filtered query is empty - fall back to the latest entry without queryText.
        if (
          wantsLatest &&
          (!entries || !entries.length) &&
          queryText &&
          !finalType &&
          !finalTopics &&
          !finalContext &&
          !dateOnOrAfter &&
          !dateBefore
        ) {
          entries = await journalRepo.listEntries({
            type: null,
            topics: null,
            context: null,
            dateOnOrAfter: null,
            dateBefore: null,
            queryText: null,
            limit: 1,
          });
          if (entries && entries.length) {
            bot.sendMessage(chatId, `По фильтру "${queryText}" ничего не нашел. Показываю последнюю запись:`);
          }
        }

        if (wantsLatest && (!entries || !entries.length)) {
          bot.sendMessage(
            chatId,
            'В дневнике не нашел записей для этой команды. Если записи точно есть в Notion, проверь, что ты запустил нужный bot mode и что Journal DB расшарена интеграции из NOTION_TOKEN.'
          );
          return;
        }

        await renderAndRememberJournalList({ chatId, entries: entries || [], title: 'Дневник (Journal):' });
        return;
      }

      if (toolName === 'notion.find_journal_entries') {
        if (!journalRepo) {
          bot.sendMessage(chatId, 'Journal база не подключена. Добавь NOTION_JOURNAL_DB_ID.');
          return;
        }

        const queryText = String(args?.queryText || '').trim();
        const { items, source } = await findJournalEntriesFuzzyEnhanced({ journalRepo, queryText, limit: 20 });
        const suffix = source === 'local' ? ' (локальный fuzzy)' : '';
        await renderAndRememberJournalList({ chatId, entries: items || [], title: `Найдено по "${queryText}":${suffix}` });
        return;
      }

      if (toolName === 'notion.create_journal_entry') {
        if (!journalRepo) {
          bot.sendMessage(chatId, 'Journal база не подключена. Добавь NOTION_JOURNAL_DB_ID.');
          return;
        }

        const title = args?.title ? String(args.title).trim() : oneLinePreview(userText, 64) || 'Запись';
        const date = args?.date ? String(args.date) : inferDateFromText({ userText, tz }) || yyyyMmDdInTz({ tz });
        const description = args?.description ? String(args.description) : null;
        const ratingBase = [title, description, String(userText || '')].filter(Boolean).join('\n');
        const inferredRatings = inferMoodEnergyFromText({ userText: ratingBase });
        // Required fields for Journal: always fill mood/energy.
        const mood = args?.mood !== undefined ? clampRating1to5(args.mood) : inferredRatings.mood ?? 3;
        const energy = args?.energy !== undefined ? clampRating1to5(args.energy) : inferredRatings.energy ?? 3;

        // Required fields for Journal: always fill Type/Topics/Context.
        // If options are missing in DB - create them (no duplicates) and use canonical names.
        const desiredType =
          args?.type !== undefined && args.type !== null && String(args.type).trim()
            ? String(args.type).trim()
            : inferJournalTypeFromText({ userText });

        const desiredTopicsRaw =
          args?.topics !== undefined && args.topics !== null && hasNonEmptyOptionInput(args.topics)
            ? args.topics
            : inferJournalTopicsFromText({ userText });
        const desiredTopics = Array.isArray(desiredTopicsRaw) ? desiredTopicsRaw : [desiredTopicsRaw];

        const desiredContextRaw =
          args?.context !== undefined && args.context !== null && hasNonEmptyOptionInput(args.context)
            ? args.context
            : inferJournalContextFromText({ userText });
        const desiredContext = Array.isArray(desiredContextRaw) ? desiredContextRaw : [desiredContextRaw];

        const ensured = await journalRepo.ensureJournalOptions({
          type: desiredType,
          topics: desiredTopics,
          context: desiredContext,
        });

        const finalType = ensured.type || desiredType;
        const finalTopics = ensured.topics?.length ? ensured.topics : desiredTopics;
        const finalContext = ensured.context?.length ? ensured.context : desiredContext;

        // Dedup check: if an entry with same title exists for the same date, ask before creating a duplicate.
        const key = normalizeTitleKey(title);
        const candidates = await journalRepo.listEntries({ queryText: title, limit: 10 });
        const dupe = (candidates || []).find((t) => normalizeTitleKey(t.title) === key && (t.date || null) === (date || null));
        if (dupe) {
          const actionId = makeId(`${chatId}:${Date.now()}:notion.create_journal_entry:${key}:${date}`);
          pendingToolActionByChatId.set(chatId, {
            id: actionId,
            kind: 'notion.create_journal_entry',
            payload: { title, date, type: finalType, topics: finalTopics, mood, energy, context: finalContext, description },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, `Похоже, такая запись уже есть: "${dupe.title}". Создать дубль?`, buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const created = await journalRepo.createEntry({
          title,
          date,
          type: finalType,
          topics: finalTopics,
          mood,
          energy,
          context: finalContext,
        });
        if (description) await journalRepo.appendDescription({ pageId: created.id, text: description });
        bot.sendMessage(chatId, formatJournalEntryCreateSummary({ created }));
        return;
      }

      if (toolName === 'notion.update_journal_entry') {
        if (!journalRepo) {
          bot.sendMessage(chatId, 'Journal база не подключена. Добавь NOTION_JOURNAL_DB_ID.');
          return;
        }

        // For updates: if user provided new Type/Topics/Context options that are missing, create them (no duplicates).
        if (args?.type !== undefined && args.type !== null && hasNonEmptyOptionInput(args.type)) {
          await journalRepo.ensureJournalOptions({ type: String(args.type).trim(), topics: [], context: [] });
        }
        if (args?.topics !== undefined && args.topics !== null && hasNonEmptyOptionInput(args.topics)) {
          const desiredTopics = Array.isArray(args.topics) ? args.topics : [args.topics];
          await journalRepo.ensureJournalOptions({ type: null, topics: desiredTopics, context: [] });
        }
        if (args?.context !== undefined && args.context !== null && hasNonEmptyOptionInput(args.context)) {
          const desiredContext = Array.isArray(args.context) ? args.context : [args.context];
          await journalRepo.ensureJournalOptions({ type: null, topics: [], context: desiredContext });
        }

        const { type: typeOptions, topics: topicOptions, context: contextOptions } = await journalRepo.getOptions();
        const { value: normType } = pickBestOptionMatch({ input: args?.type, options: typeOptions, aliases: null });
        const normTopics = normalizeMultiOptionValue({ value: args?.topics, options: topicOptions, aliases: null });
        const normContext = normalizeMultiOptionValue({ value: args?.context, options: contextOptions, aliases: null });

        const patch = {
          title: args?.title !== undefined ? String(args.title) : undefined,
          date: args?.date !== undefined ? String(args.date) : undefined,
          type: args?.type !== undefined ? (args.type === null ? null : normType || null) : undefined,
          topics: args?.topics !== undefined ? (args.topics === null ? null : normTopics.value) : undefined,
          mood: args?.mood !== undefined ? (args.mood === null ? null : clampRating1to5(args.mood)) : undefined,
          energy: args?.energy !== undefined ? (args.energy === null ? null : clampRating1to5(args.energy)) : undefined,
          context: args?.context !== undefined ? (args.context === null ? null : normContext.value) : undefined,
        };

        const description = args?.description !== undefined ? String(args.description || '').trim() : undefined;
        const wantsAutofill = Boolean(args?.autofill) || isEmptyPatchObject(patch);
        args = { ...args, _patch: patch, _description: description, _autofill: wantsAutofill, _sourceText: String(userText || '') };
        toolName = 'notion.update_journal_entry_resolve';
      }

      if (toolName === 'notion.archive_journal_entry') {
        toolName = 'notion.archive_journal_entry_resolve';
      }

      if (toolName === 'notion.update_social_post') {
        const { platform: platforms, status: statuses, contentType: contentTypes } = await socialRepo.getOptions();

        // If user/LLM provided a platform that does not match Notion options, ask to pick it.
        if (args?.platform !== undefined && args.platform !== null) {
          const normPlatform = normalizeSocialPlatform({ platform: args.platform, platforms });
          if (!normPlatform.ok) {
            const actionId = makeId(`${chatId}:${Date.now()}:social.pick_platform_update`);
            pendingToolActionByChatId.set(chatId, {
              id: actionId,
              kind: 'social.pick_platform_update',
              payload: { draft: { ...args }, platforms },
              createdAt: Date.now(),
            });
            bot.sendMessage(
              chatId,
              'Не вижу такую платформу среди доступных для обновления. Выбери из списка:',
              buildPickPlatformKeyboard({ actionId, platforms })
            );
            return;
          }
          args = { ...args, platform: normPlatform.value };
        }

        const patch = {
          title: args?.title ? String(args.title) : undefined,
          status: args?.status ? normalizeSocialStatus({ status: String(args.status), statuses }).value : undefined,
          platform: args?.platform !== undefined ? args.platform : undefined,
          postDate: args?.postDate !== undefined ? String(args.postDate) : undefined,
          contentType: args?.contentType !== undefined ? normalizeSocialContentType({ contentType: args.contentType, contentTypes }).value : undefined,
          postUrl: args?.postUrl !== undefined ? String(args.postUrl) : undefined,
        };
        args = { ...args, _patch: patch };
        toolName = 'notion.update_social_post_resolve';
      }

      if (toolName === 'notion.archive_social_post') {
        toolName = 'notion.archive_social_post_resolve';
      }

      // Domain-specific resolution (ideas/social) before falling back to tasks resolution.
      if (toolName === 'notion.update_idea_resolve' || toolName === 'notion.archive_idea_resolve') {
        const pageId = args?.pageId ? String(args.pageId) : null;
        if (pageId) {
          const actionId = makeId(`${chatId}:${Date.now()}:${toolName}:${pageId}`);
          if (toolName === 'notion.update_idea_resolve') {
            pendingToolActionByChatId.set(chatId, {
              id: actionId,
              kind: 'notion.update_idea',
              payload: { pageId, patch: args._patch, merge: args?._mergeTags ? { tags: true } : null },
              createdAt: Date.now(),
            });
            bot.sendMessage(chatId, 'Применить изменения к идее?', buildToolConfirmKeyboard({ actionId }));
            return;
          }
          pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_idea', payload: { pageId }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Архивировать эту идею?', buildToolConfirmKeyboard({ actionId }));
          return;
        }

        // Try resolving by index from last shown ideas list.
        const idx = args?.taskIndex ? Number(args.taskIndex) : inferIndexFromText(userText);
        const lastShownIdeas = lastShownIdeasListByChatId ? lastShownIdeasListByChatId.get(chatId) || [] : [];
        if (!pageId && idx && lastShownIdeas.length) {
          const found = lastShownIdeas.find((x) => x.index === idx);
          if (found?.id) {
            args = { ...args, pageId: found.id };
            return await executeToolPlan({ chatId, from, toolName, args, userText });
          }
        }

        const queryText = String(args?.queryText || '').trim();
        const fuzzy = queryText ? await findIdeasFuzzyEnhanced({ ideasRepo, queryText, limit: 10 }) : { items: [] };
        const candidates = (fuzzy.items || []).length
          ? fuzzy.items
          : queryText
            ? []
            : (await ideasRepo.listIdeas({ queryText: null, limit: 10 })) || [];
        if (candidates.length === 1) {
          args = { ...args, pageId: candidates[0].id };
          return await executeToolPlan({ chatId, from, toolName, args, userText });
        }
        if (candidates.length > 1) {
          const items = candidates.map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, {
            id: null,
            kind: toolName === 'notion.update_idea_resolve' ? 'notion.update_idea' : 'notion.archive_idea',
            payload: { _candidates: items, patch: args._patch, merge: args?._mergeTags ? { tags: true } : null },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Нашел несколько идей. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }
        bot.sendMessage(chatId, 'Не нашел идею. Уточни запрос.');
        return;
      }

      if (toolName === 'notion.update_social_post_resolve' || toolName === 'notion.archive_social_post_resolve') {
        const pageId = args?.pageId ? String(args.pageId) : null;
        if (pageId) {
          const actionId = makeId(`${chatId}:${Date.now()}:${toolName}:${pageId}`);
          if (toolName === 'notion.update_social_post_resolve') {
            pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.update_social_post', payload: { pageId, patch: args._patch }, createdAt: Date.now() });
            bot.sendMessage(chatId, 'Применить изменения к посту?', buildToolConfirmKeyboard({ actionId }));
            return;
          }
          pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_social_post', payload: { pageId }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Архивировать этот пост?', buildToolConfirmKeyboard({ actionId }));
          return;
        }

        // Try resolving by index from last shown social list.
        const idx = args?.taskIndex ? Number(args.taskIndex) : inferIndexFromText(userText);
        const lastShownSocial = lastShownSocialListByChatId ? lastShownSocialListByChatId.get(chatId) || [] : [];
        if (!pageId && idx && lastShownSocial.length) {
          const found = lastShownSocial.find((x) => x.index === idx);
          if (found?.id) {
            args = { ...args, pageId: found.id };
            return await executeToolPlan({ chatId, from, toolName, args, userText });
          }
        }

        const queryText = String(args?.queryText || '').trim();
        const fuzzy = queryText ? await findSocialPostsFuzzyEnhanced({ socialRepo, queryText, limit: 10 }) : { items: [] };
        const candidates = fuzzy.items || [];
        if (candidates.length === 1) {
          args = { ...args, pageId: candidates[0].id };
          return await executeToolPlan({ chatId, from, toolName, args, userText });
        }
        if (candidates.length > 1) {
          const items = candidates.map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, { id: null, kind: toolName === 'notion.update_social_post_resolve' ? 'notion.update_social_post' : 'notion.archive_social_post', payload: { _candidates: items, patch: args._patch }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Нашел несколько постов. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }
        bot.sendMessage(chatId, 'Не нашел пост. Уточни запрос.');
        return;
      }

      if (toolName === 'notion.update_journal_entry_resolve' || toolName === 'notion.archive_journal_entry_resolve') {
        if (!journalRepo) {
          bot.sendMessage(chatId, 'Journal база не подключена. Добавь NOTION_JOURNAL_DB_ID.');
          return;
        }

        const pageId = args?.pageId ? String(args.pageId) : null;
        if (pageId) {
          const actionId = makeId(`${chatId}:${Date.now()}:${toolName}:${pageId}`);
          if (toolName === 'notion.update_journal_entry_resolve') {
            pendingToolActionByChatId.set(chatId, {
              id: actionId,
              kind: 'notion.update_journal_entry',
              payload: {
                pageId,
                patch: args._patch,
                description: args._description,
                autofill: Boolean(args._autofill),
                sourceText: args._sourceText ? String(args._sourceText) : '',
              },
              createdAt: Date.now(),
            });
            bot.sendMessage(chatId, 'Применить изменения к записи дневника?', buildToolConfirmKeyboard({ actionId }));
            return;
          }
          pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_journal_entry', payload: { pageId }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Архивировать эту запись дневника?', buildToolConfirmKeyboard({ actionId }));
          return;
        }

        const queryText = String(args?.queryText || '').trim();
        const resolvedFromLastShown = resolveJournalPageIdFromLastShown({ chatId, text: String(userText || '') });
        if (resolvedFromLastShown) {
          args = { ...args, pageId: resolvedFromLastShown };
          return await executeToolPlan({ chatId, from, toolName, args, userText });
        }
        const candidates = queryText
          ? (await findJournalEntriesFuzzyEnhanced({ journalRepo, queryText, limit: 10 })).items || []
          : (await journalRepo.listEntries({ queryText, limit: 10 })) || [];
        if (!queryText && candidates.length) {
          // If user did not specify which entry, default to the most recent one.
          args = { ...args, pageId: candidates[0].id };
          return await executeToolPlan({ chatId, from, toolName, args, userText });
        }
        if (candidates.length === 1) {
          args = { ...args, pageId: candidates[0].id };
          return await executeToolPlan({ chatId, from, toolName, args, userText });
        }
        if (candidates.length > 1) {
          const items = candidates.map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, {
            id: null,
            kind: toolName === 'notion.update_journal_entry_resolve' ? 'notion.update_journal_entry' : 'notion.archive_journal_entry',
            payload: {
              _candidates: items,
              patch: args._patch,
              description: args._description,
              autofill: Boolean(args._autofill),
              sourceText: args._sourceText ? String(args._sourceText) : '',
            },
            createdAt: Date.now(),
          });
          bot.sendMessage(chatId, 'Нашел несколько записей дневника. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }
        bot.sendMessage(chatId, 'Не нашел запись дневника. Уточни запрос.');
        return;
      }

      // Tasks resolution: use either taskIndex (from last list) or pageId.
      const board = typeof getTasksBoardModeForChat === 'function' ? await getTasksBoardModeForChat(chatId) : 'main';
      const tasksRepoForChat = board === 'test' && tasksRepoTest ? tasksRepoTest : tasksRepo;
      const listKey = typeof makeTasksBoardKey === 'function' ? makeTasksBoardKey(chatId, board) : chatId;
      const pageId = args?.pageId ? String(args.pageId) : null;
      const taskIndex = args?.taskIndex ? Number(args.taskIndex) : null;
      let resolvedPageId = pageId;
      let resolvedTitle = null;

      if (!resolvedPageId && taskIndex && lastShownListByChatId.has(listKey)) {
        const found = (lastShownListByChatId.get(listKey) || []).find((x) => x.index === taskIndex);
        if (found) {
          resolvedPageId = found.id;
          resolvedTitle = found.title || null;
        }
      }

      // Multi-delete: allow queryText to contain multiple task names for move_to_deprecated.
      if (toolName === 'notion.move_to_deprecated' && !resolvedPageId && args?.queryText) {
        const parts = buildMultiQueryCandidates(args.queryText);
        if (parts.length > 1) {
          args = { ...args, queryText: parts[0], _queueQueries: parts.slice(1) };
        }
      }

      // Multi mark_done: allow queryText to contain multiple task names.
      if (toolName === 'notion.mark_done' && !resolvedPageId && args?.queryText) {
        const parts = buildMultiQueryCandidates(args.queryText);
        if (parts.length > 1) {
          args = { ...args, queryText: parts[0], _queueQueries: parts.slice(1) };
        }
      }

      if (!resolvedPageId && args?.queryText) {
        const queryText = String(args.queryText).trim();
        const fuzzy = await findTasksFuzzyEnhanced({ notionRepo: tasksRepoForChat, queryText, limit: 10 });
        const candidates = (fuzzy.tasks || []).filter((t) => !t.tags.includes('Deprecated'));
        if (candidates.length === 1) {
          resolvedPageId = candidates[0].id;
          resolvedTitle = candidates[0].title || null;
        }
        if (candidates.length > 1) {
          const items = candidates.map((t, i) => ({ index: i + 1, id: t.id, title: t.title }));
          pendingToolActionByChatId.set(chatId, { id: null, kind: toolName, payload: { ...args, _candidates: items }, createdAt: Date.now() });
          bot.sendMessage(chatId, 'Нашел несколько задач. Выбери:', buildPickTaskKeyboard({ items }));
          return;
        }
        if (!candidates.length && toolName === 'notion.move_to_deprecated' && Array.isArray(args?._queueQueries) && args._queueQueries.length) {
          // If first chunk produced nothing, try next chunk automatically.
          const next = args._queueQueries[0];
          const rest = args._queueQueries.slice(1);
          await executeToolPlan({
            chatId,
            from,
            toolName,
            args: { ...args, queryText: next, _queueQueries: rest },
            userText,
          });
          return;
        }
      }

      if (!resolvedPageId) {
        bot.sendMessage(chatId, 'Не понял, к какой задаче применить действие. Напиши номер из списка или уточни название.');
        return;
      }

      if (toolName === 'notion.mark_done') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.mark_done:${resolvedPageId}`);
        const queue = Array.isArray(args?._queueQueries) && args._queueQueries.length ? args._queueQueries : undefined;
        pendingToolActionByChatId.set(chatId, {
          id: actionId,
          kind: 'notion.mark_done',
          payload: { pageId: resolvedPageId, title: resolvedTitle || null, _queueQueries: queue, _board: board },
          createdAt: Date.now(),
        });
        const titleLine = resolvedTitle ? `Задача: "${resolvedTitle}".` : null;
        bot.sendMessage(chatId, [titleLine, 'Пометить задачу как выполненную?'].filter(Boolean).join('\n'), buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.move_to_deprecated') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.move_to_deprecated:${resolvedPageId}`);
        const queue = Array.isArray(args?._queueQueries) && args._queueQueries.length ? args._queueQueries : undefined;
        pendingToolActionByChatId.set(chatId, {
          id: actionId,
          kind: 'notion.move_to_deprecated',
          payload: { pageId: resolvedPageId, title: resolvedTitle || null, _queueQueries: queue, _board: board },
          createdAt: Date.now(),
        });
        const titleLine = resolvedTitle ? `Задача: "${resolvedTitle}".` : null;
        bot.sendMessage(chatId, [titleLine, 'Перенести задачу в Deprecated?'].filter(Boolean).join('\n'), buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.update_task') {
        const board = typeof getTasksBoardModeForChat === 'function' ? await getTasksBoardModeForChat(chatId) : 'main';
        const tasksRepoForChat = board === 'test' && tasksRepoTest ? tasksRepoTest : tasksRepo;
        const { status: statusOptions, priority: priorityOptions } = await tasksRepoForChat.getOptions();

        // Status/Priority normalization
        let normStatus = args?.status !== undefined ? args.status : undefined;
        if (normStatus !== undefined && normStatus !== null) {
          const norm = pickBestOptionMatch({ input: normStatus, options: statusOptions, aliases: null });
          normStatus = norm.value || undefined;
        }

        let normPriority = args?.priority !== undefined ? args.priority : undefined;
        if (normPriority !== undefined && normPriority !== null) {
          const norm = pickBestOptionMatch({ input: normPriority, options: priorityOptions, aliases: null });
          normPriority = norm.value || undefined;
        }

        const rawTitle = args?.title ? String(args.title) : undefined;
        const rawDescription = args?.description ? String(args.description) : null;
        const split =
          rawTitle !== undefined
            ? splitLongTaskTitleToDescription({ title: rawTitle, description: rawDescription, maxTitleLen: 120 })
            : { title: rawTitle, description: rawDescription, didSplit: false };

        const patch = {
          title: split.title ? String(split.title) : undefined,
          tag: args?.tag ? normalizeCategoryInput(args.tag) : undefined,
          priority: normPriority,
          dueDate: args?.dueDate ? String(args.dueDate) : undefined,
          status: normStatus,
        };
        const actionId = makeId(`${chatId}:${Date.now()}:notion.update_task:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, {
          id: actionId,
          kind: 'notion.update_task',
          payload: { pageId: resolvedPageId, patch, description: split.description || null, title: resolvedTitle || null, _board: board },
          createdAt: Date.now(),
        });

        // Build human-readable confirmation message
        const changes = [];
        if (patch.tag) changes.push(`категория → ${patch.tag}`);
        if (patch.status) changes.push(`статус → ${patch.status}`);
        if (patch.priority) changes.push(`приоритет → ${patch.priority}`);
        if (patch.dueDate) changes.push(`дата → ${patch.dueDate}`);
        if (patch.title) changes.push(`название → "${patch.title}"`);

        const taskLine = resolvedTitle ? `Задача: "${resolvedTitle}"` : 'Задача найдена';
        const changesLine = changes.length ? `Изменения: ${changes.join(', ')}` : 'Изменения не указаны';
        bot.sendMessage(chatId, `${taskLine}\n${changesLine}\n\nПрименить?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.append_description') {
        const text = String(args?.text || '').trim();
        const actionId = makeId(`${chatId}:${Date.now()}:notion.append_description:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, {
          id: actionId,
          kind: 'notion.append_description',
          payload: { pageId: resolvedPageId, text, _board: board },
          createdAt: Date.now(),
        });
        bot.sendMessage(chatId, 'Добавить это в описание задачи?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.update_idea_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.update_idea:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, {
          id: actionId,
          kind: 'notion.update_idea',
          payload: { pageId: resolvedPageId, patch: args._patch, merge: args?._mergeTags ? { tags: true } : null },
          createdAt: Date.now(),
        });
        bot.sendMessage(chatId, 'Применить изменения к идее?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.archive_idea_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.archive_idea:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_idea', payload: { pageId: resolvedPageId }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Архивировать эту идею?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.update_social_post_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.update_social_post:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.update_social_post', payload: { pageId: resolvedPageId, patch: args._patch }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Применить изменения к посту?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      if (toolName === 'notion.archive_social_post_resolve') {
        const actionId = makeId(`${chatId}:${Date.now()}:notion.archive_social_post:${resolvedPageId}`);
        pendingToolActionByChatId.set(chatId, { id: actionId, kind: 'notion.archive_social_post', payload: { pageId: resolvedPageId }, createdAt: Date.now() });
        bot.sendMessage(chatId, 'Архивировать этот пост?', buildToolConfirmKeyboard({ actionId }));
        return;
      }

      bot.sendMessage(chatId, 'Неизвестная операция.');
    } catch (e) {
      const err = extractNotionErrorInfo(e);
      debugLog('tool_error', { tool: toolName, message: err.message, code: err.code, status: err.status, requestId: err.requestId });

      const debug = String(process.env.TG_DEBUG || '') === '1';
      if (debug) {
        bot.sendMessage(chatId, `Ошибка Notion: ${truncate(err.short, 800)}`);
      } else {
        bot.sendMessage(chatId, 'Ошибка при выполнении операции с Notion.');
      }
    }
  }

  return { executeToolPlan };
}

module.exports = { createToolExecutor };


