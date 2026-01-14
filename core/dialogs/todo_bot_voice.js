const fs = require('fs');

const { aiAnalyzeMessage } = require('../ai/todo_intent');
const { planAgentAction } = require('../ai/agent_planner');

const { downloadTelegramFileToTmp } = require('../connectors/telegram/files');
const { convertOggToWav16kMono } = require('../connectors/stt/ffmpeg');
const { transcribeWavWithOpenAI } = require('../connectors/stt/openai_whisper');
const { sanitizeErrorForLog } = require('../runtime/log_sanitize');
const { isLikelyPreferenceText, extractExplicitMemoryNoteText, isExplicitMemoryCommandWithoutPayload } = require('../ai/preference_extractor');

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

const VOICE_JOB_TTL_MS = 10 * 60 * 1000;
const voiceJobsById = new Map(); // actionId -> job

function cleanupVoiceJobs(now = Date.now()) {
  for (const [id, job] of voiceJobsById.entries()) {
    if (!job?.createdAt) {
      voiceJobsById.delete(id);
      continue;
    }
    if (now - job.createdAt > VOICE_JOB_TTL_MS) voiceJobsById.delete(id);
  }
}

function registerVoiceJob(job) {
  cleanupVoiceJobs();
  voiceJobsById.set(job.actionId, job);
  return job;
}

function cancelVoiceJobByActionId({ actionId }) {
  const id = String(actionId || '').trim();
  if (!id) return null;
  const job = voiceJobsById.get(id) || null;
  if (!job) return null;
  job.cancelled = true;
  try {
    job.abortController?.abort();
  } catch {}
  return job;
}

function buildVoiceCancelKeyboard({ actionId }) {
  const id = String(actionId || '').trim();
  return {
    reply_markup: {
      inline_keyboard: [[{ text: 'Отмена', callback_data: `vc:${id}`.slice(0, 64) }]],
    },
  };
}

class VoiceCancelledError extends Error {
  constructor() {
    super('voice_cancelled');
    this.code = 'VOICE_CANCELLED';
  }
}

function renderVoiceStatus({ stage, transcriptPreview = null }) {
  // Keep it plain text (no Markdown) to avoid escaping issues.
  // Telegram doesn't allow styling the bubble itself, but emojis + concise text improve readability.
  const st = String(stage || '').trim().toLowerCase();
  if (st === 'downloading') return '🎙️ Голос: ⬇️ скачиваю…';
  if (st === 'converting') return '🎙️ Голос: 🔁 конвертирую (ffmpeg)…';
  if (st === 'stt') return '🎙️ Голос: 🧠 распознаю (STT)…';
  if (st === 'planning') return '🎙️ Голос: 🤖 анализирую…';
  if (st === 'executing') return '🎙️ Голос: ⚡ выполняю…';
  if (st === 'no_text') return '🎙️ Голос: ⚠️ не удалось распознать текст.';
  if (st === 'error') return '🎙️ Голос: ❌ ошибка при обработке.';
  if (st === 'done') {
    const p = transcriptPreview ? String(transcriptPreview).trim() : '';
    return p ? `🎙️ Распознано: ${p}` : '🎙️ Готово.';
  }
  return '🎙️ Голос: …';
}

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
  handleAdminChatMemoryQuery = null, // async ({ text }) => boolean (admin-only, reads from Postgres chat memory)
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

  const actionId = makeId(`${chatId}:${Date.now()}:voice:${msg.voice.file_unique_id || msg.voice.file_id || ''}`);
  const abortController = new AbortController();
  const job = registerVoiceJob({
    actionId,
    chatId,
    statusMessageId: null,
    abortController,
    cancelled: false,
    createdAt: Date.now(),
  });

  const throwIfCancelled = () => {
    if (job.cancelled || abortController.signal.aborted) throw new VoiceCancelledError();
  };

  const statusMsg = await bot.sendMessage(chatId, renderVoiceStatus({ stage: 'downloading' }), buildVoiceCancelKeyboard({ actionId }));
  const statusMessageId = statusMsg?.message_id;
  job.statusMessageId = statusMessageId || null;

  let transcriptPreview = null;
  let didFinalizeStatus = false;

  const finalizeStatus = async () => {
    if (didFinalizeStatus) return;
    didFinalizeStatus = true;
    if (job.cancelled) return;
    if (!statusMessageId || !transcriptPreview) return;
    try {
      await bot.editMessageText(renderVoiceStatus({ stage: 'done', transcriptPreview }), {
        chat_id: chatId,
        message_id: statusMessageId,
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      // If we cannot edit the status message (rate limit, message deleted, etc), send a small fallback message.
      try {
        if (!job.cancelled) await bot.sendMessage(chatId, renderVoiceStatus({ stage: 'done', transcriptPreview }));
      } catch {}
    }
  };

  let oggPath = null;
  let wavPath = null;
  let stage = 'download';

  try {
    stage = 'download';
    throwIfCancelled();
    const dl = await downloadTelegramFileToTmp({
      bot,
      fileId: msg.voice.file_id,
      prefix: 'tg_voice',
      ext: 'ogg',
      signal: abortController.signal,
    });
    oggPath = dl.outPath;
    debugLog('voice_downloaded', { chatId, bytes: fs.statSync(oggPath).size });

    if (statusMessageId)
      await safeEditStatus({
        bot,
        chatId,
        messageId: statusMessageId,
        text: renderVoiceStatus({ stage: 'converting' }),
        replyMarkup: buildVoiceCancelKeyboard({ actionId }).reply_markup,
      });
    stage = 'convert';
    throwIfCancelled();
    const conv = await convertOggToWav16kMono({ inputPath: oggPath, signal: abortController.signal });
    wavPath = conv.wavPath;

    if (statusMessageId)
      await safeEditStatus({
        bot,
        chatId,
        messageId: statusMessageId,
        text: renderVoiceStatus({ stage: 'stt' }),
        replyMarkup: buildVoiceCancelKeyboard({ actionId }).reply_markup,
      });
    stage = 'stt';
    throwIfCancelled();
    const stt = await transcribeWavWithOpenAI({ apiKey, wavPath, model: sttModel, language: lang, signal: abortController.signal });
    const transcript = stt.text;

    debugLog('voice_transcribed', { chatId, text_len: transcript.length, text_preview: transcript.slice(0, 80) });

    if (!transcript) {
      if (statusMessageId)
        await safeEditStatus({
          bot,
          chatId,
          messageId: statusMessageId,
          text: renderVoiceStatus({ stage: 'no_text' }),
          replyMarkup: { inline_keyboard: [] },
        });
      return;
    }

    transcriptPreview = oneLinePreview(transcript, 90);

    // If the user explicitly asks to remember/save something, do not let the planner respond without persistence.
    // Only short-circuit for explicit memory commands; for other preference-like text keep normal planner flow.
    if (typeof maybeSuggestPreferenceFromText === 'function') {
      const isExplicitMemory = Boolean(extractExplicitMemoryNoteText(transcript) || isExplicitMemoryCommandWithoutPayload(transcript));
      if (isExplicitMemory && isLikelyPreferenceText(transcript)) {
        const handled = await maybeSuggestPreferenceFromText({
          chatId,
          userText: String(transcript || ''),
          sourceMessageId: msg?.message_id || null,
        });
        if (handled) {
          await finalizeStatus();
          return;
        }
      }
    }

    // Admin-only: handle chat memory queries deterministically (range/time) before planner.
    if (typeof handleAdminChatMemoryQuery === 'function') {
      try {
        const handled = await handleAdminChatMemoryQuery({ text: transcript });
        if (handled) {
          await finalizeStatus();
          return;
        }
      } catch {
        // ignore
      }
    }

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

    // Cancel button is meant for download/convert/stt stages. Remove it right before LLM calls.
    if (statusMessageId) {
      await safeEditStatus({
        bot,
        chatId,
        messageId: statusMessageId,
        text: renderVoiceStatus({ stage: 'planning' }),
        replyMarkup: { inline_keyboard: [] },
      });
      try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: statusMessageId });
      } catch {}
    }
    throwIfCancelled();

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
        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: renderVoiceStatus({ stage: 'executing' }) });
        throwIfCancelled();
        await executeToolPlan({ chatId, from, toolName: plan.tool.name, args: plan.tool.args, userText: transcript });
        await finalizeStatus();
        return;
      }
    } catch (e) {
      if (job.cancelled || abortController.signal.aborted) throw new VoiceCancelledError();
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

        if (statusMessageId) await safeEditStatus({ bot, chatId, messageId: statusMessageId, text: renderVoiceStatus({ stage: 'executing' }) });
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
    if (e?.code === 'VOICE_CANCELLED' || e?.code === 'ABORT_ERR' || e?.code === 'ERR_CANCELED' || job.cancelled || abortController.signal.aborted) {
      // Silent cancel: no messages, no status updates.
      return;
    }
    const safe = sanitizeErrorForLog(e);
    debugLog('voice_error', {
      chatId,
      stage,
      code: safe?.code || null,
      message: safe?.message || String(e?.message || e),
      status: e?.response?.status || null,
    });
    if (statusMessageId)
      await safeEditStatus({
        bot,
        chatId,
        messageId: statusMessageId,
        text: renderVoiceStatus({ stage: 'error' }),
        replyMarkup: { inline_keyboard: [] },
      });
    const adminIds = String(process.env.TG_ADMIN_CHAT_IDS || '')
      .split(',')
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n));
    const isAdmin = adminIds.includes(Number(chatId));
    if (isAdmin) {
      const msgLower = String(e?.message || '').toLowerCase();
      const hint =
        stage === 'download'
          ? 'Похоже, не удается скачать voice файл из Telegram (timeout/сеть). Проверь VPN/файрвол и доступ к api.telegram.org/file.'
          : String(e?.message || '').includes('OpenAI STT failed') || e?.response?.status === 403
            ? 'Похоже, OpenAI STT вернул 403. Проверь права ключа/проект и доступ к audio/transcriptions или попробуй TG_STT_MODEL=gpt-4o-mini-transcribe.'
            : msgLower.includes('429')
              ? 'Похоже, лимит OpenAI (429). Подожди и попробуй снова.'
              : null;
      bot.sendMessage(
        chatId,
        [
          'Voice ошибка.',
          `- stage: ${stage}`,
          `- error: ${safe?.code || '-'} ${safe?.message || String(e?.message || e)}`,
          hint ? `- hint: ${hint}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } else {
      bot.sendMessage(chatId, 'Не получилось обработать voice. Попробуй еще раз или отправь текстом.');
    }
  } finally {
    if (job.cancelled) {
      // Best-effort: delete the status message if still present.
      if (job.statusMessageId) {
        try {
          await bot.deleteMessage(chatId, job.statusMessageId);
        } catch {}
      }
    }

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
    voiceJobsById.delete(actionId);
  }
}

module.exports = { handleVoiceMessage, cancelVoiceJobByActionId };


