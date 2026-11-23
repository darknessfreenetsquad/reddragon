'use strict';

const axios = require('axios');
const { redDragon } = require('../lib/response-style');

const FACEBOOK_OMEGA_API = 'https://api.omegatech.app/api/download/Facebook';
const FACEBOOK_NEXRAY_API = 'https://api.nexray.eu.cc/downloader/facebook';
const FACEBOOK_TIMEOUT = 30000;
const FACEBOOK_MAX_SIZE = 100 * 1024 * 1024;

function firstUrl(...values) {
  for (const value of values.flat(Infinity)) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (value && typeof value === 'object') {
      const nested = firstUrl(value.url, value.download, value.downloadUrl, value.directUrl, value.hd, value.video, value.video_hd, value.video_sd);
      if (nested) return nested;
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

function getFacebookUrl(text = '') {
  const match = String(text).match(/https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\/[^\s]+/i);
  return match ? match[0].replace(/[)\]}>,]+$/, '') : null;
}

function findFacebookVideoUrl(data) {
  if (!data || typeof data !== 'object') return null;
  const preferred = ['directUrl', 'downloadUrl', 'videoUrl', 'hd', 'sd', 'url'];
  for (const key of preferred) {
    const value = data[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value) && /\.(mp4|m3u8)(?:\?|$)/i.test(value)) return value;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const result = findFacebookVideoUrl(item);
      if (result) return result;
    }
  } else {
    for (const value of Object.values(data)) {
      if (value && typeof value === 'object') {
        const result = findFacebookVideoUrl(value);
        if (result) return result;
      }
    }
  }
  return null;
}

async function getFacebookVideo(url) {
  try {
    const response = await axios.post(FACEBOOK_OMEGA_API, { action: 'resolve', url, quality: 'hd' }, {
      timeout: FACEBOOK_TIMEOUT,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    const videoUrl = findFacebookVideoUrl(response.data);
    if (videoUrl) return { videoUrl, source: 'OmegaTech' };
  } catch (error) {
    console.warn('[FB] OmegaTech:', error.message);
  }

  try {
    const response = await axios.get(FACEBOOK_NEXRAY_API, {
      params: { url },
      timeout: FACEBOOK_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const videoUrl = findFacebookVideoUrl(response.data);
    if (videoUrl) return { videoUrl, source: 'NexRay' };
  } catch (error) {
    console.warn('[FB] NexRay:', error.message);
  }

  throw new Error('Unable to download this Facebook video. It may be private, login-protected, or unsupported.');
}

async function downloadFacebookVideo(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: FACEBOOK_MAX_SIZE,
    maxBodyLength: FACEBOOK_MAX_SIZE,
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.facebook.com/' }
  });
  return validateMediaResponse(response, FACEBOOK_MAX_SIZE).buffer;
}

const providers = {
  fb: {
    aliases: ['fb', 'facebook'],
    endpoints: [
      {
        url: process.env.FACEBOOK_API_ENDPOINT || 'https://api.omegatech.app/api/download/facebook',
        params: input => ({ action: 'download', url: input })
      },
      {
        url: 'https://api.siputzx.my.id/api/download/fb',
        params: input => ({ url: input })
      },
      {
        url: 'https://api.hanggts.xyz/download/facebook',
        params: input => ({ url: input })
      }
    ],
    field: data => firstUrl(data?.data, data?.result, data),
    type: 'video',
    label: 'Facebook'
  },
  instagram: { aliases: ['instagram', 'ig'], endpoint: 'https://api.siputzx.my.id/api/download/instagram', field: data => firstUrl(data?.result, data?.data, data), type: 'video', label: 'Instagram' },
  tiktok: { aliases: ['tiktok', 'tt'], endpoint: 'https://api.siputzx.my.id/api/download/tiktok', field: data => firstUrl(data?.result, data?.data, data), type: 'video', label: 'TikTok' },
  twitter: { aliases: ['twitter', 'tw'], endpoint: 'https://api.siputzx.my.id/api/download/twitter', field: data => firstUrl(data?.result, data?.data, data), type: 'video', label: 'Twitter' }
};
const aliases = Object.values(providers).flatMap(provider => provider.aliases);

function findProvider(command) {
  return Object.values(providers).find(provider => provider.aliases.includes(command));
}

module.exports = {
  commands: aliases,
  validateMediaResponse,
  getFacebookUrl,
  findFacebookVideoUrl,
  getFacebookVideo,
  downloadFacebookVideo,
  async run(ctx) {
    const { socket, from, msg, command, args, footer } = ctx;
    const provider = findProvider(command);
    const facebookInput = Array.isArray(args) ? args.join(' ') : String(args || '');
    const url = provider === providers.fb
      ? getFacebookUrl(facebookInput) || getFacebookUrl(msg?.message?.conversation || '') || getFacebookUrl(msg?.message?.extendedTextMessage?.text || '')
      : args[0];
    if (!url) {
      await socket.sendMessage(from, { text: redDragon(`${provider.label} DOWNLOADER`, [`Usage: .${command} <url>`], footer) }, { quoted: msg });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      await socket.sendMessage(from, { text: redDragon('INVALID URL', ['Use a complete http or https link.'], footer) }, { quoted: msg });
      return;
    }
    await socket.sendMessage(from, { react: { text: '📥', key: msg.key } });
    try {
      if (provider === providers.fb) {
        const result = await getFacebookVideo(url);
        const video = await downloadFacebookVideo(result.videoUrl);
        await socket.sendMessage(from, {
          video,
          mimetype: 'video/mp4',
          caption: redDragon('FACEBOOK DOWNLOAD', [
            'Download complete.',
            `Provider: ${result.source}`
          ], footer)
        }, { quoted: msg });
        return;
      }

      const targets = provider.endpoints || [{ url: provider.endpoint, params: () => ({ url }) }];
      let mediaUrl = null;
      let lastError = null;
      for (const target of targets) {
        try {
          const { data } = await axios.get(target.url, { timeout: 15000, params: target.params(url) });
          mediaUrl = provider.field(data);
          if (mediaUrl && /^https:\/\//i.test(mediaUrl)) break;
          lastError = new Error('Provider returned no downloadable media.');
        } catch (error) {
          lastError = error;
        }
      }
      if (!mediaUrl || !/^https:\/\//i.test(mediaUrl)) {
        throw lastError || new Error('No downloadable media was returned.');
      }
      const response = await axios.get(mediaUrl, {
        timeout: 60000,
        responseType: 'arraybuffer',
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024
      });

      const { buffer, mime: responseMime } = validateMediaResponse(response);
      const mime = responseMime || 'video/mp4';

      await socket.sendMessage(from, {
        document: buffer,
        mimetype: mime,
        fileName: `${provider.label.toLowerCase()}-download.${mime.includes('video') ? 'mp4' : 'bin'}`,
        caption: redDragon(`${provider.label.toUpperCase()} DOWNLOAD`, [
          'Download complete.',
          'File attached.'
        ], footer)
      }, { quoted: msg });
    } catch (error) {
      console.error(`${command} downloader error:`, error.message);
      await socket.sendMessage(from, { text: redDragon(`${provider.label} DOWNLOAD FAILED`, [error.message], footer) }, { quoted: msg });
    }
  }
};
