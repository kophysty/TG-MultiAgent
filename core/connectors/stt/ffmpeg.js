const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

function run(cmd, args, { signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      try {
        p.kill();
      } catch {}
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    p.stderr.on('data', (d) => {
      stderr += String(d || '');
    });
    p.on('error', (e) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(e);
    });
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (aborted) return reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
      if (code === 0) return resolve();
      return reject(new Error(`ffmpeg failed (code=${code}): ${stderr.slice(0, 400)}`));
    });
  });
}

async function convertOggToWav16kMono({ inputPath, outputPath, signal = null }) {
  if (!ffmpegPath) throw new Error('ffmpeg-static not available');
  const out = outputPath || path.join(path.dirname(inputPath), `${path.basename(inputPath)}.wav`);

  // Convert Telegram OGG/OPUS to WAV 16kHz mono PCM
  await run(ffmpegPath, ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-f', 'wav', out], { signal });
  return { wavPath: out };
}

module.exports = { convertOggToWav16kMono };
