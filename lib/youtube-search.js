'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const SEARCH_TIMEOUT = 10000;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function extractJson(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = source.indexOf('{', start + marker.length);
  if (open < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(open, index + 1)); } catch { return null; }
    }
  }
  return null;
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value?.runs)) return value.runs.map(run => run.text || '').join('');
  return value?.simpleText || '';
}

function findVideoRenderers(value, results = []) {
  if (!value || typeof value !== 'object') return results;
  if (value.videoRenderer?.videoId) results.push(value.videoRenderer);
  for (const child of Object.values(value)) findVideoRenderers(child, results);
  return results;
}

function parseSearchResults(html) {
  const initial = extractJson(html, 'ytInitialData');
  const renderers = findVideoRenderers(initial || {});
  const videos = renderers.map(video => ({
    videoId: video.videoId,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    title: textOf(video.title),
    author: { name: textOf(video.ownerText || video.longBylineText) },
    timestamp: textOf(video.lengthText),
    thumbnail: video.thumbnail?.thumbnails?.at(-1)?.url || null,
    seconds: 0
  })).filter(video => video.title && video.url);
  const unique = new Map(videos.map(video => [video.videoId, video]));
  return [...unique.values()];
}

async function searchYouTube(query) {
  const text = String(query || '').trim();
  if (!text) return { videos: [] };
  const { data } = await axios.get('https://www.youtube.com/results', {
    timeout: SEARCH_TIMEOUT,
    params: { search_query: text },
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    responseType: 'text'
  });
  const videos = parseSearchResults(String(data || ''));
  if (!videos.length) {
    // Some responses expose only a script shell; Cheerio still gives us a useful
    // no-result distinction without introducing another scraper dependency.
    const $ = cheerio.load(String(data || ''));
    if ($('title').text().toLowerCase().includes('consent')) throw new Error('YouTube search requires consent.');
  }
  return { videos };
}

module.exports = { searchYouTube, parseSearchResults, extractJson };
