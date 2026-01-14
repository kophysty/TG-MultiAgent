const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

function makeTmpName(prefix, ext) {
  const id = crypto.randomBytes(8).toString('hex');
  return `${prefix}_${id}${ext ? `.${ext}` : ''}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDownloadError(e) {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EAI_AGAIN' || code === 'ENOTFOUND') return true;

  const status = e?.response?.status;
  // Telegram file download can transiently fail via gateways/proxies.
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  // 404 can happen if the signed link expires, retry after re-fetching link.
  if (status === 404) return true;

  const msg = String(e?.message || '').toLowerCase();
  if (msg.includes('socket hang up')) return true;
  return false;
}

async function downloadTelegramFileToTmp({ bot, fileId, prefix = 'tg_voice', ext = 'ogg', signal = null }) {
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, makeTmpName(prefix, ext));

  // Keep defaults conservative: fail fast on broken routing (VPN/geo), but allow overrides.
  const timeoutMs = Math.max(10_000, Number(process.env.TG_VOICE_DOWNLOAD_TIMEOUT_MS || 60_000));
  const retries = Math.min(6, Math.max(1, Number(process.env.TG_VOICE_DOWNLOAD_RETRIES || 1)));
  const retryBaseMs = Math.min(10_000, Math.max(250, Number(process.env.TG_VOICE_DOWNLOAD_RETRY_BASE_MS || 1000)));

  let lastUrl = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // node-telegram-bot-api provides a signed file URL via getFileLink.
      // Fetch it per attempt to handle expired links.
      // eslint-disable-next-line no-await-in-loop
      const url = await bot.getFileLink(fileId);
      lastUrl = url;

      // eslint-disable-next-line no-await-in-loop
      const resp = await axios.get(url, { responseType: 'stream', timeout: timeoutMs, signal: signal || undefined });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(outPath);
        resp.data.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        resp.data.on('error', reject);
      });

      return { outPath, url };
    } catch (e) {
      lastErr = e;
      try {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      } catch {}

      if (attempt >= retries) break;
      if (!isRetryableDownloadError(e)) break;

      // eslint-disable-next-line no-await-in-loop
      await sleep(retryBaseMs * 2 ** (attempt - 1));
    }
  }

  // Keep error message generic here to avoid accidental token leaks through the URL.
  const code = lastErr?.code ? String(lastErr.code) : null;
  const status = lastErr?.response?.status ? Number(lastErr.response.status) : null;
  const details = [code ? `code=${code}` : null, status ? `http=${status}` : null].filter(Boolean).join(' ');
  throw new Error(`Telegram voice download failed${details ? ` (${details})` : ''}`);

  // unreachable
  // return { outPath, url: lastUrl };
}

module.exports = { downloadTelegramFileToTmp };



