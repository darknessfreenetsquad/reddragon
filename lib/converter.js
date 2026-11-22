'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function ffmpeg(buffer, args = [], ext = 'bin', ext2 = 'bin') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('A non-empty media buffer is required.');
  const tempDir = await fs.promises.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'red-mini-ffmpeg-'));
  const input = path.join(tempDir, `input.${String(ext).replace(/[^a-z0-9]/gi, '') || 'bin'}`);
  const output = path.join(tempDir, `output.${String(ext2).replace(/[^a-z0-9]/gi, '') || 'bin'}`);
  try {
    await fs.promises.writeFile(input, buffer, { mode: 0o600 });
    await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', ['-y', '-i', input, ...args, output], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${stderr.slice(-500)}`)));
    });
    return await fs.promises.readFile(output);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function toAudio(buffer, ext = 'bin') {
  return ffmpeg(buffer, ['-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100', '-f', 'mp3'], ext, 'mp3');
}
function toPTT(buffer, ext = 'bin') {
  return ffmpeg(buffer, ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-compression_level', '10'], ext, 'opus');
}
function toVideo(buffer, ext = 'bin') {
  return ffmpeg(buffer, ['-c:v', 'libx264', '-c:a', 'aac', '-ab', '128k', '-ar', '44100', '-crf', '32', '-preset', 'slow'], ext, 'mp4');
}

module.exports = { toAudio, toPTT, toVideo, ffmpeg };
