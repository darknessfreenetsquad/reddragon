'use strict';

const axios = require('axios');
const { redDragon, cleanFileName } = require('../lib/response-style');
const { searchYouTube: searchYouTubeWeb } = require('../lib/youtube-search');

const OMEGA_BASE = process.env.OMEGATECH_API_BASE || 'https://api.omegatech.app/api';
const REQUEST_TIMEOUT = 15000;
const YOUTUBE_SEARCH_TIMEOUT = 12000;
const YOUTUBE_FALLBACK_TIMEOUT = 8000;
const YOUTUBE_CACHE_TTL = 30000;
const YOUTUBE_STALE_TTL = 10 * 60 * 1000;
const YOUTUBE_CACHE_LIMIT = 100;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const YOUTUBE_SEARCH_FALLBACK_URL = process.env.YOUTUBE_SEARCH_FALLBACK_URL || '';
const youtubeSearchCache = new Map();

function clean(value, fallback = 'Unknown') {
  return String(value ?? fallback).replace(/[\r\n]+/g, ' ').trim();
}

function requireText(args, usage) {
  const text = args.join(' ').trim();
  if (!text) throw new Error(`Usage: ${usage}`);
  return text.slice(0, 300);
}

function ensureSuccess(payload, httpStatus = 200) {
  if (httpStatus >= 400 || payload?.success === false || payload?.status === false) {
    const error = payload?.error || payload?.message || 'Omegatech request failed.';
    throw new Error(clean(error, 'Omegatech request failed.'));
  }
  if (payload?.data && typeof payload.data === 'object') return payload.data;
  if (payload?.result && typeof payload.result === 'object') return payload.result;
  return payload && typeof payload === 'object' ? payload : {};
}

async function get(path, params) {
  const { data, status } = await axios.get(`${OMEGA_BASE}${path}`, { timeout: REQUEST_TIMEOUT, params });
  return ensureSuccess(data, status);
}

function linesForSongSearch(data) {
  const song = data.song || 'Unknown';
  const artist = data.artist || 'Unknown';
  const lines = [
    `Song: ${clean(song)}`,
    `Artist: ${clean(artist)}`,
    data.album ? `Album: ${clean(data.album)}` : '',
    data.year && data.year !== 'n/a' ? `Year: ${clean(data.year)}` : '',
    data.relevantChunk ? `Match: “${clean(data.relevantChunk).slice(0, 160)}”` : '',
    data.previewUrl ? `Preview: ${data.previewUrl}` : '',
    data.youtubeUrl ? `YouTube: ${data.youtubeUrl}` : '',
    data.webSources?.[0]?.url ? `Lyrics source: ${data.webSources[0].url}` : ''
  ];
  return lines.filter(Boolean);
}

function formatTrending(data) {
  const items = Array.isArray(data.items) ? data.items.slice(0, 10) : [];
  if (!items.length) return ['No trending songs were returned.'];
  return [
    `Showing ${items.length} of ${data.count || items.length} songs:`,
    ...items.map((item, index) => {
      const explicit = item.explicit ? ' [Explicit]' : '';
      return `${index + 1}. ${clean(item.title || item.song)} — ${clean(item.artist)}${explicit}\n   ${item.pageUrl || ''}`;
    })
  ];
}

function formatCeenaija(data) {
  const items = Array.isArray(data.items) ? data.items.slice(0, 10) : [];
  if (!items.length) return ['No Ceenaija results were returned.'];
  return [
    `Results for: ${clean(data.q)}`,
    ...items.map((item, index) => `${index + 1}. ${clean(item.fullTitle || `${item.song} — ${item.artist}`)}\n   ${item.link || ''}${item.youtubeUrl ? `\n   YouTube: ${item.youtubeUrl}` : ''}`)
  ];
}

function formatAnime(data) {
  const items = Array.isArray(data.results) ? data.results.slice(0, 10) : [];
  if (!items.length) return ['No anime results were returned.'];
  return [
    `Results for: ${clean(data.query)}`,
    ...items.map((item, index) => `${index + 1}. ${clean(item.title)} (${clean(item.type)})\n   Crunchyroll ID: ${clean(item.crId)}\n   ${clean(item.description, 'No description available.').slice(0, 180)}`)
  ];
}

function bytesLabel(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function chooseVideo(formats) {
  return formats
    .map(format => {
      const url = format?.downloadUrl || format?.download_url || format?.url;
      const sizeBytes = Number.isFinite(format?.sizeBytes) ? format.sizeBytes : parseSizeBytes(format?.sizeBytes || format?.sizeLabel || format?.size);
      return url ? { ...format, downloadUrl: url, sizeBytes } : null;
    })
    .filter(format => format && (!Number.isFinite(format.sizeBytes) || format.sizeBytes <= MAX_VIDEO_BYTES))
    .sort((a, b) => Number(b.height || 0) - Number(a.height || 0))[0] || null;
}

function parseSizeBytes(value) {
  if (Number.isFinite(value)) return value;
  const match = String(value || '').match(/([\d.]+)\s*(GB|MB|KB|B)/i);
  if (!match) return null;
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Number(match[1]) * units[match[2].toUpperCase()];
}

function youtubeLines(data) {
  const lines = [
    `Title: ${clean(data.title)}`,
    `Channel: ${clean(data.channel)}`,
    `Duration: ${clean(data.durationLabel)}`,
    `Source: ${data.url || ''}`,
    '',
    'Available formats:'
  ];
  for (const format of (data.videoFormats || []).slice(0, 6)) {
    lines.push(`${format.label || format.quality}: ${format.sizeLabel || bytesLabel(format.sizeBytes)}${format.downloadUrl ? '' : ' (unavailable)'}`);
  }
  if (data.audio?.mp3?.downloadUrl) lines.push(`Audio MP3: ${data.audio.mp3.bitrateKbps || 128} kbps`);
  lines.push('', 'Signed download URLs expire quickly; they are not stored by the bot.');
  return lines;
}

async function searchSong(query) {
  return get('/Search/searchthatsong', { action: 'search', query });
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function directYouTubeResult(query) {
  const url = String(query || '').trim();
  if (!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url)) return null;
  return { videos: [{ url, title: 'YouTube audio', videoId: url }] };
}

async function fallbackYouTubeSearch(query) {
  const direct = directYouTubeResult(query);
  if (direct) return direct;
  if (!YOUTUBE_SEARCH_FALLBACK_URL) return null;
  const { data } = await axios.get(YOUTUBE_SEARCH_FALLBACK_URL, {
    timeout: YOUTUBE_FALLBACK_TIMEOUT,
    params: { q: query, query }
  });
  const videos = Array.isArray(data?.videos) ? data.videos
    : Array.isArray(data?.data?.videos) ? data.data.videos
      : Array.isArray(data?.result) ? data.result : [];
  return { videos: videos.filter(video => video?.url).slice(0, 10), fallback: true };
}

async function searchYouTube(query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key) return { videos: [] };
  const cached = youtubeSearchCache.get(key);
  if (cached?.promise) return cached.promise;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const primary = withTimeout(searchYouTubeWeb(key), YOUTUBE_SEARCH_TIMEOUT, 'YouTube search timed out.');
  const fallbackAvailable = Boolean(YOUTUBE_SEARCH_FALLBACK_URL || directYouTubeResult(key));
  const searchRequest = fallbackAvailable
    ? Promise.race([primary, withTimeout(fallbackYouTubeSearch(key), YOUTUBE_FALLBACK_TIMEOUT, 'YouTube fallback search timed out.')])
    : primary;
  const previousValue = cached?.value;
  const previousStaleUntil = cached?.staleUntil || 0;
  const promise = searchRequest.then(result => {
    const value = result && Array.isArray(result.videos) ? result : { videos: [] };
    youtubeSearchCache.set(key, { value, expiresAt: Date.now() + YOUTUBE_CACHE_TTL, staleUntil: Date.now() + YOUTUBE_STALE_TTL });
    while (youtubeSearchCache.size > YOUTUBE_CACHE_LIMIT) youtubeSearchCache.delete(youtubeSearchCache.keys().next().value);
    return value;
  }).catch(async error => {
    const current = youtubeSearchCache.get(key);
    if (current?.value && current.staleUntil > Date.now()) return { ...current.value, stale: true };
    const fallback = await fallbackYouTubeSearch(key).catch(() => null);
    if (fallback?.videos?.length) return fallback;
    throw error;
  }).finally(() => {
    const current = youtubeSearchCache.get(key);
    if (current?.promise === promise) youtubeSearchCache.delete(key);
  });
  youtubeSearchCache.set(key, { promise, value: previousValue, staleUntil: previousStaleUntil, expiresAt: Date.now() + YOUTUBE_SEARCH_TIMEOUT });
  return promise;
}

async function downloadPlayAudio(url) {
  let lastError;
  try {
    const { data, status } = await axios.get('https://apis-keith.vercel.app/download/dlmp3', {
      timeout: 8000,
      validateStatus: () => true,
      params: { url }
    });
    const result = data?.result || data?.data || data;
    const downloadUrl = result?.downloadUrl || result?.download_url || result?.url || result?.audio;
    if (status < 400 && data?.status !== false && /^https?:\/\//i.test(downloadUrl || '')) {
      return { ...result, downloadUrl };
    }
    lastError = new Error('Keith API returned no audio URL.');
  } catch (error) {
    lastError = error;
  }
  try {
    const data = await get('/download/YouTube', { action: 'download', url, type: 'audio', bitrate: 128 });
    const downloadUrl = data?.audio?.mp3?.downloadUrl || data?.audio?.m4a?.downloadUrl || data?.downloadUrl || data?.download_url || data?.url;
    if (!/^https?:\/\//i.test(downloadUrl || '')) throw new Error('Omegatech returned no audio URL.');
    return { ...data, downloadUrl, title: data.title || 'YouTube audio', provider: 'youtube-fallback' };
  } catch (error) {
    throw new Error(`Audio download failed: ${error.message || lastError?.message || 'provider unavailable'}`);
  }
}

async function downloadAudioBuffer(url) {
  const response = await axios.get(url, {
    timeout: 60000,
    responseType: 'arraybuffer',
    maxContentLength: MAX_AUDIO_BYTES,
    maxBodyLength: MAX_AUDIO_BYTES,
    validateStatus: status => status >= 200 && status < 300
  });

  const buffer = Buffer.from(response.data);

  if (!buffer.length) throw new Error('Empty audio file.');
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error('Audio exceeds the 20 MB limit.');
  }

  return buffer;
}

async function trendingSongs() {
  return get('/download/audiomack', { action: 'trending', show: 'songs' });
}

async function searchCeenaija(query) {
  return get('/download/ceenaija', { action: 'search', q: query });
}

async function searchAnime(query) {
  return get('/Anime/Crunchyroll', { action: 'search', q: query });
}

async function youtubeDownload(url, type = 'video') {
  return get('/download/YouTube', { action: 'download', url, type, bitrate: 128 });
}

module.exports = {
  commands: ['play', 'songsearch', 'findsong', 'trending', 'audiomacktrending', 'ceenaija', 'anime', 'crunchyroll', 'ytdl', 'ytvideo', 'ytaudio'],
  searchSong,
  searchYouTube,
  downloadPlayAudio,
  downloadAudioBuffer,
  trendingSongs,
  searchCeenaija,
  searchAnime,
  youtubeDownload,
  chooseVideo,
  async run(ctx) {
    const { socket, from, msg, command, args, footer } = ctx;
    if (ctx.skipNetwork) {
      await socket.sendMessage(from, { text: redDragon('OMEGATECH', [`Usage path verified for .${command}.`], footer) }, { quoted: msg });
      return;
    }
    try {
      if (command === 'play') {
        const query = args.join(' ').trim().slice(0, 300);
        if (!query) {
          await socket.sendMessage(from, { text: redDragon('PLAY', ['What song do you want to download?'], footer) }, { quoted: msg });
          return;
        }

        let search;
        try {
          search = await module.exports.searchYouTube(query);
        } catch (error) {
          await socket.sendMessage(from, { text: redDragon('PLAY ERROR', ['YouTube search failed. Please try again later.'], footer) }, { quoted: msg });
          return;
        }

        const video = Array.isArray(search?.videos) ? search.videos[0] : null;
        if (!video?.url) {
          await socket.sendMessage(from, { text: redDragon('PLAY SEARCH', ['No songs found!'], footer) }, { quoted: msg });
          return;
        }

        await socket.sendMessage(from, { text: redDragon('PLAY', ['Please wait, your download is in progress.'], footer) }, { quoted: msg });

        let result;
        try {
          result = await module.exports.downloadPlayAudio(video.url);
        } catch (error) {
          const message = error.message === 'Failed to fetch audio from the API. Please try again later.'
            ? error.message
            : 'Download failed. Please try again later.';
          await socket.sendMessage(from, { text: redDragon('PLAY ERROR', [message], footer) }, { quoted: msg });
          return;
        }

        const title = clean(result.title || video.title, 'red-dragon-play');
        const fileName = cleanFileName(`${title}.mp3`, 'red-dragon-play.mp3');
        const audioBuffer = await module.exports.downloadAudioBuffer(result.downloadUrl);
        const caption = result.provider === 'youtube-fallback'
          ? redDragon('MUSIC DOWNLOAD', [
            'Provider: YouTube fallback',
            `Title: ${result.title || video.title || 'Unknown'}`
          ], footer)
          : redDragon('PLAY DOWNLOAD', [
            `Title: ${title}`,
            'Format: MP3'
          ], footer);
        await socket.sendMessage(from, {
          document: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName,
          caption
        }, { quoted: msg });
        return;
      }

      if (command === 'songsearch' || command === 'findsong') {
        const query = requireText(args, `.${command} <lyrics, song, or artist>`);
        const data = await searchSong(query);
        await socket.sendMessage(from, { text: redDragon('SONG SEARCH', linesForSongSearch(data), footer) }, { quoted: msg });
        return;
      }

      if (command === 'trending' || command === 'audiomacktrending') {
        const data = await trendingSongs();
        await socket.sendMessage(from, { text: redDragon('AUDIOMACK TRENDING', formatTrending(data), footer) }, { quoted: msg });
        return;
      }

      if (command === 'ceenaija') {
        const query = requireText(args, '.ceenaija <song or artist>');
        const data = await searchCeenaija(query);
        await socket.sendMessage(from, { text: redDragon('CEENAIJA SEARCH', formatCeenaija(data), footer) }, { quoted: msg });
        return;
      }

      if (command === 'anime' || command === 'crunchyroll') {
        const query = requireText(args, `.${command} <anime title>`);
        const data = await searchAnime(query);
        await socket.sendMessage(from, { text: redDragon('CRUNCHYROLL SEARCH', formatAnime(data), footer) }, { quoted: msg });
        return;
      }

      if (command === 'ytdl' || command === 'ytvideo' || command === 'ytaudio') {
        const url = requireText(args, `.${command} <YouTube URL>`);
        if (!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url)) {
          throw new Error('Use a complete YouTube URL. Search phrases are not supported by this endpoint.');
        }
        const type = command === 'ytaudio' ? 'audio' : 'video';
        const data = await youtubeDownload(url, type);
        if (command === 'ytdl') {
          await socket.sendMessage(from, { text: redDragon('YOUTUBE MEDIA', youtubeLines(data), footer) }, { quoted: msg });
          return;
        }

        if (command === 'ytaudio') {
          const audioUrl = data.audio?.mp3?.downloadUrl || data.audio?.m4a?.downloadUrl;
          if (!audioUrl) throw new Error('No audio format was returned.');
          const audioBuffer = await downloadAudioBuffer(audioUrl);
          await socket.sendMessage(from, {
            document: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: cleanFileName(`${clean(data.title, 'youtube-audio')}.mp3`),
            caption: redDragon('YOUTUBE AUDIO', [
              `Title: ${clean(data.title)}`,
              `Channel: ${clean(data.channel)}`,
              'Format: MP3'
            ], footer)
          }, { quoted: msg });
          return;
        }

        const video = chooseVideo(data.videoFormats || []);
        if (!video) {
          await socket.sendMessage(from, { text: redDragon('YOUTUBE VIDEO', [...youtubeLines(data), '', 'No video format under the 50 MB bot limit was available.'], footer) }, { quoted: msg });
          return;
        }
        await socket.sendMessage(from, {
          video: { url: video.downloadUrl },
          caption: redDragon('YOUTUBE VIDEO', [`${clean(data.title)} — ${clean(data.channel)}`, `Quality: ${video.label || video.quality}`, `Size: ${video.sizeLabel || bytesLabel(video.sizeBytes)}`, 'Signed URL is temporary and was not stored.'], footer)
        }, { quoted: msg });
      }
    } catch (error) {
      await socket.sendMessage(from, { text: redDragon('OMEGATECH ERROR', [error.message], footer) }, { quoted: msg });
    }
  }
};
