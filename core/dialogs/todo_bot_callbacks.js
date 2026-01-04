const {
  debugLog,
  oneLinePreview,
  makeId,
  truncate,
  buildToolConfirmKeyboard,
  buildPickTaskKeyboard,
  buildDateKeyboard,
  normalizeOptionKey,
  normalizeCategoryInput,
  normalizeDueDateInput,
  inferJournalTypeFromText,
  inferJournalTopicsFromText,
  inferJournalContextFromText,
  inferMoodEnergyFromText,
} = require('./todo_bot_helpers');

const crypto = require('crypto');
const { PreferencesRepo } = require('../connectors/postgres/preferences_repo');
const { MemorySuggestionsRepo } = require('../connectors/postgres/memory_suggestions_repo');
const { makeTraceId } = require('../runtime/trace');

function md5(text) {
  return crypto.createHash('md5').update(String(text || ''), 'utf8').digest('hex');
}

function computePreferenceSyncHash({ externalId, key, scope, category, active, valueHuman, valueJson }) {
  const payload = {
    externalId: String(externalId || ''),
    key: String(key || ''),
    scope: String(scope || ''),
    category: String(category || ''),
    active: Boolean(active),
    valueHuman: String(valueHuman || ''),
    valueJson: typeof valueJson === 'string' ? String(valueJson) : JSON.stringify(valueJson || {}),
  };
  return md5(JSON.stringify(payload));
}

function createCallbackQueryHandler({
  bot,
  tasksRepo,
  ideasRepo,
  socialRepo,
  journalRepo,
  pendingToolActionByChatId,
  executeToolPlan,
  confirmAiDraft,
  cancelAiDraft,
  clearTimer,
  timers,
  pendingTask,
  taskTextById,
  waitingFor,
  DATE_CATEGORIES,
  notionRepo,
  chatSecurity,
  pgPool = null,
  eventLogRepo = null,
}) {
  return async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const traceId = makeTraceId();
    debugLog('incoming_callback', { chatId, data: String(action).slice(0, 80) });

    if (eventLogRepo) {
      eventLogRepo
        .appendEvent({
          traceId,
          chatId,
          tgMessageId: query?.message?.message_id || null,
          component: 'todo_bot',
          event: 'incoming_callback',
          level: 'info',
          payload: { dataPreview: String(action || '').slice(0, 120) },
        })
        .catch(() => {});
    }

    if (chatSecurity) {
      try {
        await chatSecurity.touchFromCallback(query);
        if (await chatSecurity.shouldBlockChat(chatId)) {
          await chatSecurity.maybeReplyRevoked(chatId);
          bot.answerCallbackQuery(query.id);
          return;
        }
      } catch {
        // ignore security failures
      }
    }

    if (action && action.startsWith('tool:')) {
      const [, act, actionId] = action.split(':');
      const pending = pendingToolActionByChatId.get(chatId) || null;

      if (!pending || !pending.id || pending.id !== actionId) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Подтверждение устарело. Повтори команду.');
        return;
      }

      if (act === 'cancel') {
        pendingToolActionByChatId.delete(chatId);
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Ок, отменил.');
        return;
      }

      if (act === 'confirm') {
        const kind = pending.kind;
        const payload = pending.payload;
        pendingToolActionByChatId.delete(chatId);
        bot.answerCallbackQuery(query.id);
        try {
          if (kind === 'notion.mark_done') {
            await tasksRepo.markDone({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Пометил как выполнено.');
            return;
          }
          if (kind === 'notion.move_to_deprecated') {
            await tasksRepo.moveToDeprecated({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Перенес в Deprecated.');
            if (Array.isArray(payload._queueQueries) && payload._queueQueries.length) {
              const next = payload._queueQueries[0];
              const rest = payload._queueQueries.slice(1);
              await executeToolPlan({
                chatId,
                from: query?.from?.username || null,
                toolName: 'notion.move_to_deprecated',
                args: { queryText: next, _queueQueries: rest },
                userText: String(next || ''),
              });
            }
            return;
          }
          if (kind === 'notion.update_task') {
            await tasksRepo.updateTask({ pageId: payload.pageId, ...payload.patch });
            bot.sendMessage(chatId, 'Готово. Обновил задачу.');
            return;
          }
          if (kind === 'notion.append_description') {
            await tasksRepo.appendDescription({ pageId: payload.pageId, text: payload.text });
            bot.sendMessage(chatId, 'Готово. Добавил описание.');
            return;
          }
          if (kind === 'notion.create_task') {
            const safePayload = { ...(payload || {}) };
            if (safePayload.dueDate) safePayload.dueDate = normalizeDueDateInput({ dueDate: safePayload.dueDate, tz: process.env.TG_TZ || 'Europe/Moscow' });
            const created = await tasksRepo.createTask(safePayload);
            if (payload.description) await tasksRepo.appendDescription({ pageId: created.id, text: payload.description });
            bot.sendMessage(chatId, `Готово. Создал задачу: ${created.title}`);
            return;
          }
          if (kind === 'notion.create_idea') {
            const created = await ideasRepo.createIdea(payload);
            if (payload.description) await ideasRepo.appendDescription({ pageId: created.id, text: payload.description });
            bot.sendMessage(chatId, `Готово. Добавил идею: ${created.title}`);
            return;
          }
          if (kind === 'notion.create_social_post') {
            const created = await socialRepo.createPost(payload);
            if (payload.description) await socialRepo.appendDescription({ pageId: created.id, text: payload.description });
            bot.sendMessage(chatId, `Готово. Добавил пост: ${created.title}`);
            return;
          }
          if (kind === 'notion.create_journal_entry') {
            if (!journalRepo) throw new Error('journalRepo missing');
            const { description, ...rest } = payload || {};
            const created = await journalRepo.createEntry(rest);
            if (description) await journalRepo.appendDescription({ pageId: created.id, text: description });
            bot.sendMessage(chatId, `Готово. Добавил запись в дневник: ${created.title}`);
            return;
          }
          if (kind === 'notion.update_idea') {
            const patch = payload.patch || {};
            if (payload.merge?.tags && patch.tags !== undefined && typeof ideasRepo.getIdea === 'function') {
              let current = null;
              try {
                current = await ideasRepo.getIdea({ pageId: payload.pageId });
              } catch {
                current = null;
              }
              const cur = Array.isArray(current?.tags) ? current.tags : current?.tags ? [current.tags] : [];
              const add = Array.isArray(patch.tags) ? patch.tags : patch.tags ? [patch.tags] : [];
              const seen = new Set(cur.map((x) => normalizeOptionKey(x)));
              const merged = [...cur];
              for (const t of add) {
                const key = normalizeOptionKey(t);
                if (!key) continue;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(String(t));
              }
              patch.tags = merged;
            }
            await ideasRepo.updateIdea({ pageId: payload.pageId, ...patch });
            bot.sendMessage(chatId, 'Готово. Обновил идею.');
            return;
          }
          if (kind === 'notion.archive_idea') {
            await ideasRepo.archiveIdea({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Архивировал идею.');
            return;
          }
          if (kind === 'notion.update_social_post') {
            await socialRepo.updatePost({ pageId: payload.pageId, ...payload.patch });
            bot.sendMessage(chatId, 'Готово. Обновил пост.');
            return;
          }
          if (kind === 'notion.archive_social_post') {
            await socialRepo.archivePost({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Архивировал пост.');
            return;
          }
          if (kind === 'notion.update_journal_entry') {
            if (!journalRepo) throw new Error('journalRepo missing');
            let patch = payload.patch || {};

            if (payload.autofill) {
              let current = null;
              let contentText = '';
              try {
                current = await journalRepo.getEntry({ pageId: payload.pageId });
              } catch {
                current = null;
              }
              try {
                contentText = await journalRepo.getEntryContentText({ pageId: payload.pageId, limitChars: 1500 });
              } catch {
                contentText = '';
              }

              const baseText = [payload.sourceText, current?.title, contentText].filter(Boolean).join('\n');
              const desiredType = inferJournalTypeFromText({ userText: baseText });
              const desiredTopics = inferJournalTopicsFromText({ userText: baseText });
              const desiredContext = inferJournalContextFromText({ userText: baseText });
              const ratings = inferMoodEnergyFromText({ userText: baseText });

              const ensured = await journalRepo.ensureJournalOptions({
                type: desiredType,
                topics: desiredTopics,
                context: desiredContext,
              });

              const computed = {
                type: ensured.type || desiredType,
                topics: ensured.topics?.length ? ensured.topics : desiredTopics,
                context: ensured.context?.length ? ensured.context : desiredContext,
                mood: ratings.mood ?? 3,
                energy: ratings.energy ?? 3,
              };

              // Important: do not rely on \b for Cyrillic, it is not Unicode-aware in JS regex.
              const overwrite = /(перезаполн|перезаполни|обнови\s+все|все\s+поля|пересчитай|переопредели)/i.test(
                String(payload.sourceText || '')
              );

              const next = { ...patch };
              if (overwrite) {
                if (next.type === undefined) next.type = computed.type;
                if (next.topics === undefined) next.topics = computed.topics;
                if (next.context === undefined) next.context = computed.context;
                if (next.mood === undefined) next.mood = computed.mood;
                if (next.energy === undefined) next.energy = computed.energy;
              } else {
                const curTopics = Array.isArray(current?.topics) ? current.topics : [];
                const curContext = Array.isArray(current?.context) ? current.context : [];
                if ((current?.type === null || current?.type === undefined) && next.type === undefined) next.type = computed.type;
                if (!curTopics.length && next.topics === undefined) next.topics = computed.topics;
                if (!curContext.length && next.context === undefined) next.context = computed.context;
                if ((current?.mood === null || current?.mood === undefined) && next.mood === undefined) next.mood = computed.mood;
                if ((current?.energy === null || current?.energy === undefined) && next.energy === undefined) next.energy = computed.energy;
              }

              patch = next;
            }

            await journalRepo.updateEntry({ pageId: payload.pageId, ...patch });
            if (payload.description) await journalRepo.appendDescription({ pageId: payload.pageId, text: payload.description });
            bot.sendMessage(chatId, 'Готово. Обновил запись дневника.');
            return;
          }
          if (kind === 'notion.archive_journal_entry') {
            if (!journalRepo) throw new Error('journalRepo missing');
            await journalRepo.archiveEntry({ pageId: payload.pageId });
            bot.sendMessage(chatId, 'Готово. Архивировал запись дневника.');
            return;
          }
          bot.sendMessage(chatId, 'Неизвестная операция.');
        } catch {
          bot.sendMessage(chatId, 'Не получилось выполнить действие в Notion.');
        }
        return;
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action && action.startsWith('mem:')) {
      // mem:accept:<id> | mem:reject:<id>
      const parts = action.split(':');
      const act = parts[1] || '';
      const id = parts[2] || '';
      const suggestionId = Number(id);
      if (!pgPool) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Postgres не настроен. Нельзя сохранить память.');
        return;
      }
      if (!Number.isFinite(suggestionId)) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Подтверждение устарело. Повтори сообщение.');
        return;
      }

      const suggestionsRepo = new MemorySuggestionsRepo({ pool: pgPool });
      const prefsRepo = new PreferencesRepo({ pool: pgPool });
      const row = await suggestionsRepo.getSuggestionById({ id: suggestionId, chatId });
      if (!row) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Подтверждение устарело. Повтори сообщение.');
        return;
      }
      if (row.status !== 'pending') {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Уже обработано.');
        return;
      }

      if (act === 'reject') {
        await suggestionsRepo.decideSuggestion({ id: suggestionId, chatId, status: 'rejected' });
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Ок, не буду сохранять.');
        return;
      }

      if (act === 'accept') {
        const cand = row.candidate || {};
        const key = String(cand.key || '').trim();
        const scope = String(cand.scope || 'global').trim() || 'global';
        const category = cand.category === null || cand.category === undefined ? null : String(cand.category || '').trim() || null;
        const valueHuman = String(cand.value_human || cand.valueHuman || '').trim();
        const valueJson = cand.value_json && typeof cand.value_json === 'object' ? cand.value_json : {};

        if (!key || !valueHuman) {
          bot.answerCallbackQuery(query.id);
          bot.sendMessage(chatId, 'Не получилось сохранить: некорректный кандидат.');
          return;
        }

        const { externalId } = await prefsRepo.upsertPreference({
          chatId,
          scope,
          category,
          key,
          valueJson,
          valueHuman,
          active: true,
          source: 'postgres',
        });

        const syncHash = computePreferenceSyncHash({
          externalId,
          key,
          scope,
          category,
          active: true,
          valueHuman,
          valueJson,
        });

        await prefsRepo.enqueueNotionSync({
          kind: 'pref_page_upsert',
          externalId,
          payload: {
            externalId,
            chatId,
            scope,
            category,
            key,
            active: true,
            valueHuman,
            valueJson: typeof valueJson === 'string' ? valueJson : JSON.stringify(valueJson || {}),
            syncHash,
            lastSource: 'postgres',
            updatedAt: new Date().toISOString(),
          },
          payloadHash: syncHash,
        });

        await suggestionsRepo.decideSuggestion({ id: suggestionId, chatId, status: 'accepted' });

        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, `Сохранил preference: ${key} - ${oneLinePreview(valueHuman, 120)}`);
        return;
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action && action.startsWith('pick:')) {
      const suffix = action.split(':')[1] || '';
      if (suffix === 'cancel') {
        pendingToolActionByChatId.delete(chatId);
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Ок, отменил.');
        return;
      }

      const idx = Number(suffix);
      const pending = pendingToolActionByChatId.get(chatId);
      if (!pending || !Number.isFinite(idx)) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Выбор устарел. Попробуй еще раз.');
        return;
      }

      const items = pending.payload?._candidates || [];
      const chosen = items.find((x) => x.index === idx);
      if (!chosen) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Не нашел выбранный пункт. Попробуй еще раз.');
        return;
      }

      // Replace pending action with resolved pageId and ask for confirmation.
      const kind = pending.kind;
      const actionId = makeId(`${chatId}:${Date.now()}:${kind}:${chosen.id}`);
      pendingToolActionByChatId.set(chatId, { id: actionId, kind, payload: { ...pending.payload, pageId: chosen.id }, createdAt: Date.now() });

      bot.answerCallbackQuery(query.id);

      if (kind === 'notion.mark_done') {
        bot.sendMessage(chatId, `Пометить выполнено: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.move_to_deprecated') {
        bot.sendMessage(chatId, `Перенести в Deprecated: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.update_task') {
        bot.sendMessage(chatId, `Обновить задачу: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.append_description') {
        bot.sendMessage(chatId, `Добавить описание к: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.update_idea') {
        bot.sendMessage(chatId, `Обновить идею: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.archive_idea') {
        bot.sendMessage(chatId, `Архивировать идею: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.update_social_post') {
        bot.sendMessage(chatId, `Обновить пост: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.archive_social_post') {
        bot.sendMessage(chatId, `Архивировать пост: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.update_journal_entry') {
        bot.sendMessage(chatId, `Обновить запись дневника: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }
      if (kind === 'notion.archive_journal_entry') {
        bot.sendMessage(chatId, `Архивировать запись дневника: "${chosen.title}"?`, buildToolConfirmKeyboard({ actionId }));
        return;
      }

      bot.sendMessage(chatId, 'Ок. Подтверди действие.', buildToolConfirmKeyboard({ actionId }));
      return;
    }

    if (action && action.startsWith('plat:')) {
      const [, actionId, idxRaw] = action.split(':');
      const idx = Number(idxRaw);
      const pending = pendingToolActionByChatId.get(chatId) || null;
      if (!pending || pending.id !== actionId || !String(pending.kind || '').startsWith('social.pick_platform')) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Выбор устарел. Попробуй еще раз.');
        return;
      }
      const platforms = pending.payload?.platforms || [];
      if (!Number.isFinite(idx) || idx < 0 || idx >= platforms.length) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Не понял выбранную платформу.');
        return;
      }
      const platformName = platforms[idx];
      const draft = pending.payload?.draft || {};
      const kind = pending.kind;
      pendingToolActionByChatId.delete(chatId);
      bot.answerCallbackQuery(query.id);

      if (kind === 'social.pick_platform_list') {
        await executeToolPlan({
          chatId,
          from: null,
          toolName: 'notion.list_social_posts',
          args: { ...draft, platform: platformName },
          userText: `platform_selected:${platformName}`,
        });
        return;
      }

      if (kind === 'social.pick_platform_update') {
        await executeToolPlan({
          chatId,
          from: null,
          toolName: 'notion.update_social_post',
          args: { ...draft, platform: platformName },
          userText: `platform_selected:${platformName}`,
        });
        return;
      }

      // Default: create (will dedup and possibly ask to confirm).
      await executeToolPlan({
        chatId,
        from: null,
        toolName: 'notion.create_social_post',
        args: { ...draft, platform: platformName },
        userText: `platform_selected:${platformName}`,
      });
      return;
    }

    if (action && action.startsWith('ai:')) {
      const [, act, draftId] = action.split(':');
      if (act === 'cancel') {
        cancelAiDraft({ chatId, draftId, queryId: query.id });
        return;
      }

      if (act === 'confirm') {
        await confirmAiDraft({ chatId, draftId, queryId: query.id });
        return;
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action === 'ignore') {
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('cancel:')) {
      clearTimer(chatId);
      pendingTask.delete(chatId);
      bot.sendMessage(chatId, 'Task addition cancelled.');
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('sc:')) {
      const [, taskId, category] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      clearTimer(chatId);

      const normalizedCategory = normalizeCategoryInput(category);
      if (!normalizedCategory) {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Эта категория недоступна.');
        return;
      }

      if (DATE_CATEGORIES.includes(category)) {
        waitingFor.date.add(chatId);
        const kb = buildDateKeyboard({ taskId, category });
        bot.sendMessage(chatId, `Please select a due date for task \"${truncatedTask}\":`, kb);
        timers.set(
          chatId,
          setTimeout(async () => {
            if (!waitingFor.date.has(chatId)) return;
            waitingFor.date.delete(chatId);
            try {
              debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
              await notionRepo.createTask({ title: fullTask, tag: category, status: 'Idle' });
              debugLog('notion_result', { op: 'createTask', ok: true });
              bot.sendMessage(chatId, `Date selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" without due date.`);
            } catch {
              debugLog('notion_result', { op: 'createTask', ok: false });
              bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
            } finally {
              pendingTask.delete(chatId);
              clearTimer(chatId);
            }
          }, 60_000)
        );
        bot.answerCallbackQuery(query.id);
        return;
      }

      try {
        debugLog('notion_call', { op: 'createTask', tag: normalizedCategory, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: normalizedCategory, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${normalizedCategory}\".`);
      } catch {
        debugLog('notion_result', { op: 'createTask', ok: false });
        bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
      } finally {
        pendingTask.delete(chatId);
        clearTimer(chatId);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('priority:')) {
      // priority:{taskId}:{category}:{pmd}:{priorityOption}
      const [, taskId, category, pmdRaw, priorityOpt] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      waitingFor.priority.delete(chatId);
      clearTimer(chatId);

      const finalPriority = String(priorityOpt).toLowerCase() === 'skip' ? null : priorityOpt;

      if (DATE_CATEGORIES.includes(category)) {
        waitingFor.date.add(chatId);
        const kb = buildDateKeyboard({ taskId, category, pmd: null, priority: finalPriority });
        bot.sendMessage(chatId, `Please select a due date for task \"${truncatedTask}\":`, kb);

        timers.set(
          chatId,
          setTimeout(async () => {
            if (!waitingFor.date.has(chatId)) return;
            waitingFor.date.delete(chatId);
            try {
              debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
              await notionRepo.createTask({ title: fullTask, tag: category, priority: finalPriority, status: 'Idle' });
              debugLog('notion_result', { op: 'createTask', ok: true });
              bot.sendMessage(chatId, `Date selection time expired. Task \"${truncatedTask}\" has been added to \"${category}\" with Priority: ${finalPriority || 'not set'}.`);
            } catch {
              debugLog('notion_result', { op: 'createTask', ok: false });
              bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
            } finally {
              pendingTask.delete(chatId);
              clearTimer(chatId);
            }
          }, 30_000)
        );

        bot.answerCallbackQuery(query.id);
        return;
      }

      try {
        debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: category, priority: finalPriority, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with Priority: ${finalPriority || 'not set'}.`);
      } catch {
        debugLog('notion_result', { op: 'createTask', ok: false });
        bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
      } finally {
        pendingTask.delete(chatId);
        clearTimer(chatId);
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    if (action.startsWith('date:')) {
      // date:{taskId}:{category}:{pmd}:{priority}:{dateString}
      const [, taskId, category, pmdRaw, prioRaw, dateString] = action.split(':');
      const fullTask = taskTextById.get(taskId);
      const truncatedTask = truncate(fullTask, 20);
      waitingFor.date.delete(chatId);
      clearTimer(chatId);

      const priority = prioRaw === 'null' ? null : prioRaw;
      const dueDate = String(dateString).toLowerCase() === 'skip' ? null : dateString;

      try {
        debugLog('notion_call', { op: 'createTask', tag: category, status: 'Idle' });
        await notionRepo.createTask({ title: fullTask, tag: category, priority, dueDate, status: 'Idle' });
        debugLog('notion_result', { op: 'createTask', ok: true });
        bot.sendMessage(chatId, `Task \"${truncatedTask}\" has been added to \"${category}\" with Priority: ${priority || 'not set'}, Due Date: ${dueDate || 'not set'}.`);
      } catch {
        debugLog('notion_result', { op: 'createTask', ok: false });
        bot.sendMessage(chatId, 'Failed to add task to Notion. Please try again later.');
      } finally {
        pendingTask.delete(chatId);
        clearTimer(chatId);
      }

      bot.answerCallbackQuery(query.id);
      return;
    }

    bot.answerCallbackQuery(query.id);
  };
}

module.exports = { createCallbackQueryHandler };


