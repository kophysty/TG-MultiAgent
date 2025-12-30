function redactTelegramToken(text) {
  const s = String(text || '');
  // Telegram bot token appears in URLs like:
  // https://api.telegram.org/bot<token>/getUpdates
  // where <token> is usually: <digits>:<base64url-ish>
  return s
    .replace(/https?:\/\/api\.telegram\.org\/bot\d+:[A-Za-z0-9_-]+/g, 'https://api.telegram.org/bot<REDACTED>')
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/g, '/bot<REDACTED>');
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
  sanitizeForLog,
  sanitizeErrorForLog,
};


