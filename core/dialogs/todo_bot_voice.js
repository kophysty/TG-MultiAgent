const fs = require('fs');

const { aiAnalyzeMessage } = require('../ai/todo_intent');
const { planAgentAction } = require('../ai/agent_planner');

const { downloadTelegramFileToTmp } = require('../connectors/telegram/files');
const { convertOggToWav16kMono } = require('../connectors/stt/ffmpeg');
const { transcribeWavWithOpenAI } = require('../connectors/stt/openai_whisper');

const {
  debugLog,
  safeEditStatus,
  makeId,
  oneLinePreview,
  normalizeCategoryInput,
  buildAiConfirmKeyboard,
  formatAiTaskSummary,
  isJournalRelatedText,
  isJournalListIntent,
  isJournalArchiveIntent,
  isJournalCreateIntent,
  isJournalUpdateIntent,
} = require('./todo_bot_helpers');

async function handleVoiceMessage({
  bot,
  msg,
  chatId,
  from,
  aiModel,
  tz,
  notionCategories,
  lastShownListByChatId,
  lastShownIdeasListByChatId = null,
  lastShownSocialListByChatId = null,
  executeToolPlan,
  aiDraftByChatId,
  aiDraftById,
  getPlannerContext = null, // async () => ({ memorySummary, chatSummary, chatHistory, workContext })
  appendUserTextToChatMemory = null, // async ({ text, tgMessageId })
  maybeSuggestPreferenceFromText = null, // async ({ chatId, userText, sourceMessageId })
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    bot.sendMessage(chatId, 'Voice получен, но OPENAI_API_KEY не найден. Проверь .env.');
    return;
  }

  const sttModel = process.env.TG_STT_MODEL || 'whisper-1';
  const lang = process.env.TG_STT_LANGUAGE || 'ru';

  debugLog('voice_received', {
    chatId,
    from,
    duration: msg.voice.duration || null,
    file_unique_id: msg.voice.file_unique_id || null,
  });

  const statusMsg = await bot.sendMessage(chatId, 'Voice: скачиваю...');
  const statusMessageId = statusMsg?.message_id;

  let transcriptPreview = null;
  let didFinalizeStatus = false;

  const finalizeStatus = async () => {
    if (didFinalizeStatus) return;
    didFinalizeStatus = true;
    if (!statusMessageId || !transcriptPreview) return;
    try {
      await bot.editMessageText(`Распознано: ${transcriptPreview}`, { chat_id: chatId, message_id: statusMessageId });
    } catch {
      // If we cannot edit the status message (rate limit, message deleted, etc), send a small fallback message.
      try {
        await bot.sendMessage(chatId, `Распознано: ${transcriptPreview}`);
      } catch {}
    }
  };

  let oggPath = null;
  let wavPath = null;

  try {
    const dl = await downloadTelegramFileToTmp({ bot, fileId: msg.voice.file_id, prefix: 'tg_voice', ext: 'ogg' });
    oggPath = dl.outPath;
    debugLog('voice_downloaded', { chatId, bytes: fs.statSync(oggPath).size });

    if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: конвертирую (ffmpeg)...' });
    const conv = await convertOggToWav16kMono({ inputPath: oggPath });
    wavPath = conv.wavPath;

    if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: распознаю (STT)...' });
    const stt = await transcribeWavWithOpenAI({ apiKey, wavPath, model: sttModel, language: lang });
    const transcript = stt.text;

    debugLog('voice_transcribed', { chatId, text_len: transcript.length, text_preview: transcript.slice(0, 80) });

    if (!transcript) {
      if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: не удалось распознать текст.' });
      return;
    }

    transcriptPreview = oneLinePreview(transcript, 90);

    // Best-effort: store voice transcript as a user message in chat memory.
    if (typeof appendUserTextToChatMemory === 'function') {
      try {
        await appendUserTextToChatMemory({ text: transcript, tgMessageId: msg?.message_id || null });
      } catch {
        // ignore
      }
    }

    // Best-effort: run preference suggestion on voice transcript too.
    if (typeof maybeSuggestPreferenceFromText === 'function') {
      Promise.resolve()
        .then(() =>
          maybeSuggestPreferenceFromText({
            chatId,
            userText: String(transcript || ''),
            sourceMessageId: msg?.message_id || null,
          })
        )
        .catch(() => {});
    }

    if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: формирую задачу...' });

    // Voice transcript should go through the same planner->tools path as text messages.
    const allowedCategories = notionCategories.length ? notionCategories : ['Inbox'];
    const lastShown = lastShownListByChatId.get(chatId) || [];
    const lastShownIdeas = lastShownIdeasListByChatId ? lastShownIdeasListByChatId.get(chatId) || [] : [];
    const lastShownSocial = lastShownSocialListByChatId ? lastShownSocialListByChatId.get(chatId) || [] : [];
    try {
      const ctx = typeof getPlannerContext === 'function' ? await getPlannerContext({ userText: transcript }) : {};
      const plan = await planAgentAction({
        apiKey,
        model: aiModel,
        userText: transcript,
        allowedCategories,
        lastShownList: lastShown,
        lastShownIdeasList: lastShownIdeas,
        lastShownSocialList: lastShownSocial,
        tz,
        nowIso: new Date().toISOString(),
        memorySummary: ctx?.memorySummary || null,
        chatSummary: ctx?.chatSummary || null,
        chatHistory: ctx?.chatHistory || null,
        workContext: ctx?.workContext || null,
      });

      if (plan.type === 'chat') {
        await finalizeStatus();
        // Guard: for Journal-related intents, do not let the model ask the user to provide fields.
        if (isJournalRelatedText(transcript)) {
          const toolName = isJournalListIntent(transcript)
            ? 'notion.list_journal_entries'
            : isJournalArchiveIntent(transcript)
              ? 'notion.archive_journal_entry'
              : isJournalCreateIntent(transcript)
                ? 'notion.create_journal_entry'
                : isJournalUpdateIntent(transcript)
                  ? 'notion.update_journal_entry'
                  : 'notion.create_journal_entry';

          const args =
            toolName === 'notion.create_journal_entry'
              ? { title: oneLinePreview(transcript, 64) || 'Запись', description: transcript }
              : toolName === 'notion.update_journal_entry'
                ? { queryText: null, autofill: true }
                : { queryText: null };

          await executeToolPlan({ chatId, from, toolName, args, userText: transcript });
          return;
        }

        bot.sendMessage(chatId, plan.chat.message);
        return;
      }

      if (plan.type === 'tool') {
        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: выполняю...' });
        await executeToolPlan({ chatId, from, toolName: plan.tool.name, args: plan.tool.args, userText: transcript });
        await finalizeStatus();
        return;
      }
    } catch (e) {
      debugLog('planner_error', { source: 'voice', message: String(e?.message || e) });
      if (isJournalRelatedText(transcript)) {
        const toolName = isJournalListIntent(transcript)
          ? 'notion.list_journal_entries'
          : isJournalArchiveIntent(transcript)
            ? 'notion.archive_journal_entry'
            : isJournalCreateIntent(transcript)
              ? 'notion.create_journal_entry'
              : isJournalUpdateIntent(transcript)
                ? 'notion.update_journal_entry'
                : 'notion.create_journal_entry';

        const args =
          toolName === 'notion.create_journal_entry'
            ? { title: oneLinePreview(transcript, 64) || 'Запись', description: transcript }
            : toolName === 'notion.update_journal_entry'
              ? { queryText: null, autofill: true }
              : { queryText: null };

        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: выполняю...' });
        await executeToolPlan({ chatId, from, toolName, args, userText: transcript });
        await finalizeStatus();
        return;
      }
      // Fall back to legacy AI intent analyzer and draft confirmation flow.
    }

    // Fallback: legacy task/question -> draft confirmation (kept for robustness).
    const existingDraft = aiDraftByChatId.get(chatId) || null;
    const priorTaskDraft = existingDraft?.task || null;

    const { normalized } = await aiAnalyzeMessage({
      apiKey,
      model: aiModel,
      tz,
      nowIso: new Date().toISOString(),
      userText: transcript,
      priorTaskDraft,
      allowedCategories,
    });

    debugLog('ai_result', { type: normalized.type, source: 'voice_fallback' });

    if (normalized.type === 'question') {
      await finalizeStatus();
      bot.sendMessage(chatId, normalized.question.answer);
      return;
    }

    const draftId = existingDraft?.id || makeId(`${chatId}:${Date.now()}:${normalized.task.title}`);
    const task = normalized.task;
    const rawAiTag = Array.isArray(task.tags) && task.tags.length ? task.tags[0] : null;
    const normalizedTag = normalizeCategoryInput(rawAiTag);

    const allowedMap = new Map(allowedCategories.map((c) => [String(c).trim().toLowerCase(), c]));
    const canonical = normalizedTag ? allowedMap.get(String(normalizedTag).trim().toLowerCase()) : null;
    const finalTag = canonical || 'Inbox';
    task.tags = [finalTag];

    const draft = { id: draftId, task, updatedAt: Date.now(), awaitingConfirmation: true };
    aiDraftByChatId.set(chatId, draft);
    aiDraftById.set(draftId, { ...draft, chatId });

    await finalizeStatus();
    const kb = buildAiConfirmKeyboard({ draftId });
    bot.sendMessage(chatId, formatAiTaskSummary(task), kb);
  } catch (e) {
    debugLog('voice_error', { chatId, message: String(e?.message || e) });
    if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: 'Voice: ошибка при обработке.' });
    bot.sendMessage(chatId, 'Не получилось обработать voice. Попробуй еще раз или отправь текстом.');
  } finally {
    // Best-effort: always show the transcript preview, even if we returned early due to confirmation flows.
    try {
      await finalizeStatus();
    } catch {}
    try {
      if (oggPath) fs.unlinkSync(oggPath);
    } catch {}
    try {
      if (wavPath) fs.unlinkSync(wavPath);
    } catch {}
  }
}

module.exports = { handleVoiceMessage };


