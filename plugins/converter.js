'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const FormData = require('form-data');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { redDragon, cleanFileName } = require('../lib/response-style');
const { toSticker: convertToSticker } = require('../lib/sticker');

const runFile = promisify(execFile);

function contextInfo(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo || {};
}

function mediaFromMessage(msg) {
  const quoted = contextInfo(msg).quotedMessage;
  const current = msg?.message;
  for (const source of [current, quoted]) {
    if (!source) continue;
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
      if (source[type]) return { content: source[type], type, source };
    }
  }
  return null;
}

async function readMedia(msg) {
  const found = mediaFromMessage(msg);
  if (!found) throw new Error('Reply to an image, video, audio, document, or sticker.');
  const stream = await downloadContentFromMessage(found.content, found.type.replace(/Message$/i, '').toLowerCase());
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error('Media exceeds the 20 MB limit.');
    chunks.push(chunk);
  }
  return {
    buffer: Buffer.concat(chunks),
    mime: found.content.mimetype || 'application/octet-stream',
    fileName: found.content.fileName || `red-mini-${found.type.replace(/Message$/i, '')}`,
    type: found.type
  };
}

async function toMp3(media) {
  if (media.mime.startsWith('audio/')) return media.buffer;
  if (!media.mime.startsWith('video/')) throw new Error('Reply to an audio or video for .to-music.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'red-mini-music-'));
  const input = path.join(dir, 'input');
  const output = path.join(dir, 'output.mp3');
  try {
    await fs.writeFile(input, media.buffer, { mode: 0o600 });
    if (!ffmpegPath) throw new Error('FFmpeg binary is not available on this server.');
    await runFile(ffmpegPath, [
      '-y',
      '-i', input,
      '-vn',
      '-codec:a', 'libmp3lame',
      '-q:a', '4',
      output
    ], { timeout: 45000 });
    return await fs.readFile(output);
  } finally {
    await fs.remove(dir).catch(() => {});
  }
}

async function toSticker(media) {
  if (!media.mime.startsWith('image/') && !media.mime.startsWith('video/')) throw new Error('Reply to an image or video for .to-sticker.');
  return convertToSticker(media.buffer, media.mime);
}

async function uploadToUrl(media) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', media.buffer, { filename: cleanFileName(media.fileName), contentType: media.mime });
  const { data } = await axios.post(process.env.MEDIA_UPLOAD_URL || 'https://catbox.moe/user/api.php', form, {
    timeout: 60000,
    headers: form.getHeaders(),
    maxBodyLength: 20 * 1024 * 1024
  });
  const url = String(data || '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('The media host did not return a public URL.');
  return url;
}

module.exports = {
  commands: ['converctor', 'converter', 'to-url', 'tourl', 'to-doc', 'todoc', 'to-music', 'tomusic', 'to-sticker', 'tosticker'],
  async run(ctx) {
    const { socket, from, msg, command, footer } = ctx;
    if (command === 'converctor' || command === 'converter') {
      await socket.sendMessage(from, { text: redDragon('CONVERTER', [
        'Reply to media with .to-url, .to-doc, .to-music, or .to-sticker.',
        'Aliases: .tourl .todoc .tomusic .tosticker'
      ], footer) }, { quoted: msg });
      return;
    }

    try {
      const media = await readMedia(msg);
      if (command === 'to-url' || command === 'tourl') {
        const url = await uploadToUrl(media);
        await socket.sendMessage(from, { text: redDragon('MEDIA URL', [url], footer) }, { quoted: msg });
      } else if (command === 'to-doc' || command === 'todoc') {
        await socket.sendMessage(from, { document: media.buffer, mimetype: media.mime, fileName: cleanFileName(media.fileName), caption: redDragon('DOCUMENT', ['Converted successfully.'], footer) }, { quoted: msg });
      } else if (command === 'to-music' || command === 'tomusic') {
        const audio = await toMp3(media);
        await socket.sendMessage(from, {
          document: audio,
          mimetype: 'audio/mpeg',
          fileName: cleanFileName(
            `${path.parse(media.fileName).name}.mp3`,
            'converted-audio.mp3'
          ),
          caption: redDragon('MUSIC CONVERSION', [
            'Converted successfully.',
            'Format: MP3'
          ], footer)
        }, { quoted: msg });
      } else if (command === 'to-sticker' || command === 'tosticker') {
        await socket.sendMessage(from, { sticker: await toSticker(media) }, { quoted: msg });
      }
    } catch (error) {
      await socket.sendMessage(from, { text: redDragon('CONVERTER ERROR', [error.message], footer) }, { quoted: msg });
    }
  }
};

module.exports.readMedia = readMedia;
module.exports.toMp3 = toMp3;
module.exports.toSticker = toSticker;
module.exports.uploadToUrl = uploadToUrl;
