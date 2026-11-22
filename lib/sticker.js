'use strict';

const axios = require('axios');
const { ffmpeg } = require('./converter');

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT = 30000;

async function resolveBuffer(input, url) {
  if (url) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: FETCH_TIMEOUT,
      maxContentLength: MAX_MEDIA_BYTES,
      maxBodyLength: MAX_MEDIA_BYTES
    });
    return Buffer.from(response.data);
  }
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new Error('A non-empty image or video buffer is required.');
  }
  if (input.length > MAX_MEDIA_BYTES) throw new Error('Media exceeds the 20 MB limit.');
  return input;
}

function isVideoMime(mime = '') {
  return /^video\//i.test(mime) || /\.(mp4|mov|mkv|webm|avi)$/i.test(String(mime));
}

/** Convert an image or short video buffer to a WhatsApp-compatible WebP sticker. */
async function toSticker(input, mime = 'image/*', url) {
  const buffer = await resolveBuffer(input, url);
  const video = isVideoMime(mime);
  const filter = video
    ? 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,fps=15,format=yuva420p'
    : 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,format=rgba,setsar=1';
  const args = [
    '-vcodec', 'libwebp',
    '-vf', filter,
    ...(video ? ['-t', '6', '-lossless', '0', '-q:v', '60'] : ['-lossless', '1']),
    '-loop', '0',
    '-an',
    '-f', 'webp'
  ];
  return ffmpeg(buffer, args, video ? 'bin' : 'bin', 'webp');
}

// Compatibility aliases retained from the supplied KnightBot helper.
async function sticker2(input, url) {
  return toSticker(input, 'image/*', url);
}

async function sticker4(input, url) {
  return toSticker(input, 'image/*', url);
}

async function sticker6(input, url) {
  return toSticker(input, 'image/*', url);
}

async function sticker(input, url, packname, author) {
  const result = await toSticker(input, 'image/*', url);
  return addExif(result, packname || 'Red Mini', author || 'Red Dragon');
}

async function sticker3(input, url, packname, author) {
  return sticker(input, url, packname, author);
}

async function sticker5(input, url, packname, author) {
  return sticker(input, url, packname, author);
}

/**
 * Add WhatsApp sticker metadata when node-webpmux is installed.
 * Red Mini does not require that optional package: without it, the valid WebP
 * is returned unchanged so sticker conversion remains dependency-light.
 */
async function addExif(webpSticker, packname = 'Red Mini', author = 'Red Dragon', categories = [''], extra = {}) {
  if (!Buffer.isBuffer(webpSticker) || webpSticker.length === 0) {
    throw new Error('A non-empty WebP sticker buffer is required.');
  }
  try {
    // Optional compatibility path; do not make node-webpmux a mandatory dependency.
    const { Image } = require('node-webpmux');
    const crypto = require('crypto');
    const image = new Image();
    const json = {
      'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
      'sticker-pack-name': packname,
      'sticker-pack-publisher': author,
      emojis: categories,
      ...extra
    };
    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    await image.load(webpSticker);
    image.exif = exif;
    return image.save(null);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return webpSticker;
  }
}

const support = {
  ffmpeg: true,
  ffprobe: false,
  ffmpegWebp: true,
  convert: false,
  magick: false,
  gm: false,
  find: false
};

module.exports = {
  sticker,
  sticker2,
  sticker3,
  sticker4,
  sticker5,
  sticker6,
  addExif,
  toSticker,
  support
};
