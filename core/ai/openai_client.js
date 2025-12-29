const axios = require('axios');

function createOpenAIHttpClient({ apiKey }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing.');

  return axios.create({
    baseURL: 'https://api.openai.com/v1/',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60_000,
  });
}

async function callChatCompletions({ apiKey, model, messages, temperature = 0.2 }) {
  const http = createOpenAIHttpClient({ apiKey });

  const resp = await http.post('chat/completions', {
    model,
    messages,
    temperature,
    response_format: { type: 'json_object' },
  });

  const content = resp?.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response missing message.content');
  return content;
}

module.exports = { callChatCompletions };



