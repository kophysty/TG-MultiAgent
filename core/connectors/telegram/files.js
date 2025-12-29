const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

function makeTmpName(prefix, ext) {
  const id = crypto.randomBytes(8).toString('hex');
  return `${prefix}_${id}${ext ? `.${ext}` : ''}`;
}

async function downloadTelegramFileToTmp({ bot, fileId, prefix = 'tg_voice', ext = 'ogg' }) {
  // node-telegram-bot-api provides a signed file URL via getFileLink.
  const url = await bot.getFileLink(fileId);
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, makeTmpName(prefix, ext));

  const resp = await axios.get(url, { responseType: 'stream', timeout: 60_000 });
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    resp.data.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    resp.data.on('error', reject);
  });

  return { outPath, url };
}

module.exports = { downloadTelegramFileToTmp };



