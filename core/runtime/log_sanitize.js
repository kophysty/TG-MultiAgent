function redactTelegramToken(text) {
  const s = String(text || '');
  // Telegram bot token appears in URLs like:
  // https://api.telegram.org/bot<token>/getUpdates
  // where <token> is usually: <digits>:<base64url-ish>
  return s
    .replace(/https?:\/\/api\.telegram\.org\/bot\d+:[A-Za-z0-9_-]+/g, 'https://api.telegram.org/bot<REDACTED>')
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/g, '/bot<REDACTED>');
}

function redactSecretsForStorage(text) {
  // More strict than sanitizeForLog: intended for persistence (Postgres).
  // Redact tokens and API keys that must never be stored.
  let s = String(text || '');

  // 1) Telegram bot token (bare, not only in URLs)
  s = s.replace(/\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g, '<REDACTED_TG_TOKEN>');

  // 2) Notion token (common format: ntn_...)
  s = s.replace(/\bntn_[A-Za-z0-9]+\b/g, '<REDACTED_NOTION_TOKEN>');

  // 3) OpenAI API keys (sk-..., sk-proj-...)
  s = s.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '<REDACTED_OPENAI_KEY>');

  // 4) Authorization bearer strings (do not store any bearer values)
  s = s.replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, '$1<REDACTED_BEARER>');
  s = s.replace(/(\bBearer\s+)[A-Za-z0-9._-]+/g, '$1<REDACTED_BEARER>');

  // 5) URLs that may embed tg tokens
  s = redactTelegramToken(s);

  return s;
}

function sanitizeTextForStorage(text) {
  // Keep user-visible content, but guarantee secrets are removed.
  // Also keep size bounded to avoid bloating DB accidentally.
  const s = redactSecretsForStorage(String(text || ''));
  const maxLen = 20_000;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 12)}\n...[truncated]`;
}

function sanitizeForLog(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactTelegramToken(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    // Avoid stringifying huge nested objects (which may include request.href with token).
    if (value instanceof Error) {
      return sanitizeErrorForLog(value);
    }
    return redactTelegramToken(String(value));
  } catch {
    return '[unprintable]';
  }
}

function sanitizeErrorForLog(err) {
  const code = err?.code || err?.error_code || null;
  const message = redactTelegramToken(err?.message || err?.description || String(err || ''));
  const description = redactTelegramToken(err?.response?.body?.description || '');
  // Intentionally do NOT include full `err` object, `request`, `response`, or `stack` to avoid leaking secrets.
  return {
    code,
    message,
    description: description || null,
  };
}

module.exports = {
  redactTelegramToken,
  redactSecretsForStorage,
  sanitizeTextForStorage,
  sanitizeForLog,
  sanitizeErrorForLog,
};


