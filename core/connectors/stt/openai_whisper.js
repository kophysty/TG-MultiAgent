const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function transcribeWavWithOpenAI({ apiKey, wavPath, model = 'whisper-1', language = 'ru' }) {
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

  const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
    timeout: 120_000,
  });

  return { text: String(resp.data || '').trim() };
}

module.exports = { transcribeWavWithOpenAI };



