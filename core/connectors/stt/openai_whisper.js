const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

function uniqStrings(items) {
  const out = [];
  const seen = new Set();
  for (const x of items || []) {
    const v = String(x || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildErrHintFromResponse(data) {
  // Best-effort: OpenAI error schema often is { error: { message, type, code } }
  try {
    const msg = data?.error?.message ? String(data.error.message) : '';
    const type = data?.error?.type ? String(data.error.type) : '';
    const code = data?.error?.code ? String(data.error.code) : '';
    const parts = [msg, type ? `type=${type}` : null, code ? `code=${code}` : null].filter(Boolean);
    return parts.length ? parts.join(' | ') : null;
  } catch {
    return null;
  }
}

async function postTranscription({ apiKey, wavPath, model, language }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing.');
  if (!wavPath) throw new Error('wavPath missing.');

  const form = new FormData();
  form.append('model', model);
  form.append('language', language);
  form.append('response_format', 'text');
  form.append('file', fs.createReadStream(wavPath), {
    filename: path.basename(wavPath),
    contentType: 'audio/wav',
  });

  return await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
    maxBodyLength: Infinity,
    timeout: 120_000,
  });
}

async function transcribeWavWithOpenAI({ apiKey, wavPath, model = 'whisper-1', language = 'ru' }) {
  // Some OpenAI keys/projects can restrict access to specific models or the whole audio endpoint.
  // Try a small fallback set to keep voice working without requiring immediate config changes.
  const candidates = uniqStrings([
    model,
    process.env.TG_STT_MODEL || null,
    'gpt-4o-mini-transcribe',
    'gpt-4o-transcribe',
    'whisper-1',
  ]);

  let lastErr = null;
  for (const m of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await postTranscription({ apiKey, wavPath, model: m, language });
      return { text: String(resp.data || '').trim(), usedModel: m };
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status || null;
      const hint = buildErrHintFromResponse(e?.response?.data);

      // Only retry on a narrow set of errors that can be model-related or transient.
      const msg = String(e?.message || '');
      const mayBeModelOrAccess =
        status === 400 || status === 401 || status === 403 || status === 404 || msg.toLowerCase().includes('model');
      if (!mayBeModelOrAccess) break;

      // If this was the last model, fall through to throw below.
      continue;
    }
  }

  const status = lastErr?.response?.status || null;
  const hint = buildErrHintFromResponse(lastErr?.response?.data);
  const tail = hint ? ` (${hint})` : '';
  throw new Error(`OpenAI STT failed${status ? `: HTTP ${status}` : ''}${tail}`);

}

module.exports = { transcribeWavWithOpenAI };



