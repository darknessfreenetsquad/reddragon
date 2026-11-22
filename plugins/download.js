'use strict';

const axios = require('axios');
const { redDragon } = require('../lib/response-style');

function findMediaUrl(value) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const url = findMediaUrl(item); if (url) return url; }
  }
  if (value && typeof value === 'object') {
    for (const key of ['video', 'video_hd', 'hd', 'downloadUrl', 'download_url', 'download', 'url']) {
      const url = findMediaUrl(value[key]); if (url) return url;
    }
    for (const key of ['data', 'result', 'media']) {
      const url = findMediaUrl(value[key]); if (url) return url;
    }
  }
  return null;
}

function validateMediaResponse(response, maxBytes = 50 * 1024 * 1024) {
  const buffer = Buffer.from(response?.data || []);
  if (!buffer.length) throw new Error('The provider returned an empty file.');
  if (buffer.length > maxBytes) throw new Error('The downloaded file exceeds the size limit.');

  const mime = String(response?.headers?.['content-type'] || '')
    .split(';')[0].trim().toLowerCase();
  if (mime.includes('text/html') || mime.includes('application/json')) {
    throw new Error('The provider returned an error page instead of media.');
  }
  return { buffer, mime };
}

module.exports = {
  commands: ['download'],
  async run(ctx) {
    const { socket, from, msg, args, footer } = ctx;
    const url = args[0];
    if (!url) {
      await socket.sendMessage(from, { text: redDragon('UNIVERSAL DOWNLOADER', ['Usage: .download <url>'], footer) }, { quoted: msg });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      await socket.sendMessage(from, { text: redDragon('INVALID URL', ['Use a complete http or https link.'], footer) }, { quoted: msg });
      return;
    }
    await socket.sendMessage(from, { react: { text: '📥', key: msg.key } });
    try {
      const { data } = await axios.get('https://omegatech-api.dixonomega.tech/downloader/all', {
        timeout: 45000,
        params: { url }
      });
      const mediaUrl = findMediaUrl(data);
      if (data?.success === false || !mediaUrl) throw new Error('No downloadable video was returned.');
      const response = await axios.get(mediaUrl, {
        timeout: 60000,
        responseType: 'arraybuffer',
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024
      });

      const { buffer, mime: contentType } = validateMediaResponse(response);

      if (contentType.startsWith('audio/')) {
        await socket.sendMessage(from, {
          document: buffer,
          mimetype: contentType,
          fileName: 'downloaded-audio',
          caption: 'Download complete.'
        }, { quoted: msg });
      } else if (contentType.startsWith('image/')) {
        await socket.sendMessage(from, {
          image: buffer,
          caption: 'Download complete.'
        }, { quoted: msg });
      } else {
        await socket.sendMessage(from, {
          document: buffer,
          mimetype: contentType || 'application/octet-stream',
          fileName: 'downloaded-file',
          caption: 'Download complete.'
        }, { quoted: msg });
      }
    } catch (error) {
      console.error('universal downloader error:', error.message);
      await socket.sendMessage(from, { text: redDragon('DOWNLOAD FAILED', [error.message], footer) }, { quoted: msg });
    }
  }
};

module.exports.validateMediaResponse = validateMediaResponse;
