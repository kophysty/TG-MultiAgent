const axios = require('axios');

function createNotionHttpClient({ notionToken }) {
  return axios.create({
    baseURL: 'https://api.notion.com/v1/',
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    timeout: 60_000,
  });
}

module.exports = { createNotionHttpClient };



