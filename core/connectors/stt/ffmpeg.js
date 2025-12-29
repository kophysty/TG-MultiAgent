const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr += String(d || '');
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(`ffmpeg failed (code=${code}): ${stderr.slice(0, 400)}`));
    });
  });
}

async function convertOggToWav16kMono({ inputPath, outputPath }) {
  if (!ffmpegPath) throw new Error('ffmpeg-static not available');
  const out = outputPath || path.join(path.dirname(inputPath), `${path.basename(inputPath)}.wav`);

  // Convert Telegram OGG/OPUS to WAV 16kHz mono PCM
  await run(ffmpegPath, ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-f', 'wav', out]);
  return { wavPath: out };
}

module.exports = { convertOggToWav16kMono };



