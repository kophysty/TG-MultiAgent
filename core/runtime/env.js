const fs = require('fs');
const path = require('path');

function readRepoEnvText() {
  try {
    // Prefer repo root .env (this file lives in core/runtime).
    // Fallback to process.cwd() for standalone runs.
    const repoRoot = path.resolve(__dirname, '..', '..');
    const candidates = [path.join(repoRoot, '.env'), path.join(process.cwd(), '.env')];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        return fs.readFileSync(envPath, 'utf8');
      }
    }
    return '';
  } catch {
    return '';
  }
}

function stripInlineComment(value) {
  // Best-effort: support "KEY=value # comment" while keeping hashes in quoted strings.
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const firstChar = trimmed[0];
  const isQuoted = firstChar === '"' || firstChar === "'";
  if (isQuoted) return trimmed; // keep as-is, will unquote later

  const hashIdx = trimmed.indexOf('#');
  if (hashIdx === -1) return trimmed;
  return trimmed.slice(0, hashIdx).trim();
}

function unquote(value) {
  const v = String(value || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseKeyValueEnvText(text) {
  // Minimal dotenv-like parser for "KEY=VALUE" lines.
  // Comments in files are always in English.
  const out = {};
  const lines = String(text || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eqIdx = normalized.indexOf('=');
    if (eqIdx === -1) continue;

    const key = normalized.slice(0, eqIdx).trim();
    if (!key) continue;

    const valueRaw = normalized.slice(eqIdx + 1);
    const valueNoComment = stripInlineComment(valueRaw);
    const value = unquote(valueNoComment);

    if (value !== '') {
      out[key] = value;
    }
  }

  return out;
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

  // 1) Load standard KEY=VALUE variables.
  // Never override already provided environment variables (e.g. CI, system env).
  const kv = parseKeyValueEnvText(text);
  for (const [k, v] of Object.entries(kv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  // 2) Backwards-compatible extraction for your previous free-form .env style.
  const { testsToken, prodToken, notionToken } = extractSecretsFromEnvText(text);
  if (testsToken) process.env.TELEGRAM_BOT_TOKEN_TESTS ||= testsToken;
  if (prodToken) process.env.TELEGRAM_BOT_TOKEN_PROD ||= prodToken;
  if (notionToken) process.env.NOTION_TOKEN ||= notionToken;
}

module.exports = { hydrateProcessEnv };


