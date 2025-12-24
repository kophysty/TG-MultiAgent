const fs = require('fs');
const path = require('path');

function readRepoEnvText() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return '';
    return fs.readFileSync(envPath, 'utf8');
  } catch {
    return '';
  }
}

function extractSecretsFromEnvText(text) {
  // Never log these values.
  const tgTokenRe = /\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g;
  const notionTokenRe = /\bntn_[A-Za-z0-9]+\b/g;

  const lines = text.split(/\r?\n/);
  let testsToken = null;
  let prodToken = null;
  let notionToken = null;

  for (const line of lines) {
    const low = line.toLowerCase();

    if (!testsToken && low.includes('todofortests_bot')) {
      const m = line.match(tgTokenRe);
      if (m && m[0]) testsToken = m[0];
    }

    if (!prodToken && low.includes('my_temp_todo_bot')) {
      const m = line.match(tgTokenRe);
      if (m && m[0]) prodToken = m[0];
    }

    if (!notionToken && low.includes('notion')) {
      const m = line.match(notionTokenRe);
      if (m && m[0]) notionToken = m[0];
    }
  }

  return { testsToken, prodToken, notionToken };
}

function hydrateProcessEnv() {
  // Support both strict KEY=VALUE env and your current free-form .env format.
  const text = readRepoEnvText();
  if (!text) return;

  const { testsToken, prodToken, notionToken } = extractSecretsFromEnvText(text);
  if (testsToken) process.env.TELEGRAM_BOT_TOKEN_TESTS ||= testsToken;
  if (prodToken) process.env.TELEGRAM_BOT_TOKEN_PROD ||= prodToken;
  if (notionToken) process.env.NOTION_TOKEN ||= notionToken;
}

module.exports = { hydrateProcessEnv };


