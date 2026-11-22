'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_SLIDES = 30;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function looksLikeMedia(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
  return buffer.subarray(4, 8).toString('ascii') === 'ftyp' ||
    (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `FFmpeg exited with code ${code}`));
    });
  });
}

function inspectMedia(file) {
  return new Promise(resolve => {
    const child = spawn('ffmpeg', ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', () => resolve({ video: '', audio: '', height: 0 }));
    child.on('close', () => {
      const video = /Stream #\d+:\d+.*Video:\s*([a-z0-9]+)/i.exec(stderr)?.[1]?.toLowerCase() || '';
      const audio = /Stream #\d+:\d+.*Audio:\s*([a-z0-9]+)/i.exec(stderr)?.[1]?.toLowerCase() || '';
      const size = /Video:.*?(\d{2,5})x(\d{2,5})/i.exec(stderr);
      resolve({ video, audio, height: size ? Number(size[2]) : 0 });
    });
  });
}

async function toWhatsAppMp4(input, output) {
  const info = await inspectMedia(input);
  const args = ['-y', '-i', input];
  const h264 = info.video === 'h264';
  const aac = !info.audio || info.audio === 'aac';

  if (h264 && aac) {
    args.push('-c', 'copy', '-movflags', '+faststart', output);
    return runFfmpeg(args);
  }

  if (!h264) {
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p');
    if (info.height > 720) args.push('-vf', 'scale=-2:720');
  } else {
    args.push('-c:v', 'copy');
  }
  if (info.audio && !aac) args.push('-c:a', 'aac', '-b:a', '128k');
  else if (info.audio) args.push('-c:a', 'copy');
  else args.push('-an');
  args.push('-movflags', '+faststart', output);
  return runFfmpeg(args);
}

async function downloadBuffer(url, headers = {}) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('A valid HTTP(S) media URL is required.');
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: MAX_VIDEO_BYTES,
    maxBodyLength: MAX_VIDEO_BYTES,
    maxRedirects: 5,
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Encoding': 'identity', ...headers }
  });
  const buffer = Buffer.from(data);
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error('Downloaded media exceeds the 100 MB limit.');
  return buffer;
}

/** Download a video URL, normalize it for WhatsApp, and return an MP4 buffer. */
async function fetchWhatsAppVideo(videoUrl, headers = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'red-mini-wa-video-'));
  const input = path.join(dir, 'input.media');
  const output = path.join(dir, 'output.mp4');
  try {
    const source = await downloadBuffer(videoUrl, headers);
    if (!looksLikeMedia(source)) throw new Error(`Download was not a recognized video file (${source.length} bytes).`);
    await fs.promises.writeFile(input, source, { mode: 0o600 });
    await toWhatsAppMp4(input, output);
    const video = await fs.promises.readFile(output);
    if (!looksLikeMedia(video)) throw new Error('Converted file is not a recognized MP4 video.');
    return video;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Build an MP4 slideshow from image URLs, with optional audio. */
async function slideshowToWhatsAppVideo(imageUrls, audioUrl = null, headers = {}) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) throw new Error('No images for slideshow.');
  if (imageUrls.length > MAX_SLIDES) throw new Error(`A slideshow can contain at most ${MAX_SLIDES} images.`);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'red-mini-slideshow-'));
  const output = path.join(dir, 'output.mp4');
  const files = [];
  try {
    for (let i = 0; i < imageUrls.length; i++) {
      const image = await downloadBuffer(imageUrls[i], headers);
      const file = path.join(dir, `image-${i}.bin`);
      await fs.promises.writeFile(file, image, { mode: 0o600 });
      files.push(file);
    }

    let audioPath = null;
    if (audioUrl) {
      try {
        const audio = await downloadBuffer(audioUrl, headers);
        audioPath = path.join(dir, 'audio.bin');
        await fs.promises.writeFile(audioPath, audio, { mode: 0o600 });
      } catch (_) {
        audioPath = null;
      }
    }

    const duration = 3;
    if (files.length === 1) {
      const args = ['-y', '-loop', '1', '-i', files[0]];
      if (audioPath) args.push('-i', audioPath);
      args.push('-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-vf', 'scale=720:-2:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2', '-r', '30');
      if (audioPath) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
      else args.push('-t', String(duration), '-an');
      args.push('-movflags', '+faststart', output);
      await runFfmpeg(args);
    } else {
      const listPath = path.join(dir, 'list.txt');
      const list = files.map(file => `file '${file.replace(/'/g, "'\\''")}'\nduration ${duration}`).join('\n') + `\nfile '${files.at(-1).replace(/'/g, "'\\''")}'\n`;
      await fs.promises.writeFile(listPath, list, { mode: 0o600 });
      const slideshow = path.join(dir, 'slideshow.mp4');
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-vf', 'scale=720:-2:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,format=yuv420p', '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+faststart', slideshow]);
      if (audioPath) {
        await runFfmpeg(['-y', '-i', slideshow, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', output]);
      } else {
        await fs.promises.copyFile(slideshow, output);
      }
    }

    const video = await fs.promises.readFile(output);
    if (!looksLikeMedia(video)) throw new Error('Slideshow render failed.');
    return video;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { looksLikeMedia, toWhatsAppMp4, fetchWhatsAppVideo, slideshowToWhatsAppVideo, downloadBuffer, inspectMedia };
