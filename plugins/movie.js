'use strict';

const axios = require('axios');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_QUEUE = 20;
const MAX_CONCURRENT = 2;
const cache = new Map();
const pending = new Map();
const queue = [];
let active = 0;

function cacheKey(query) {
  return String(query || '').trim().toLowerCase();
}

function cleanText(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function formatResults(results) {
  return results.slice(0, 5).map((movie, index) => {
    const year = movie.release_date ? movie.release_date.slice(0, 4) : 'N/A';
    const rating = Number.isFinite(movie.vote_average) ? movie.vote_average.toFixed(1) : 'N/A';
    const overview = cleanText(movie.overview, 180) || 'No overview available.';
    return `${index + 1}. *${cleanText(movie.title, 80)}* (${year})\n⭐ ${rating}/10\n${overview}\n🔗 https://www.themoviedb.org/movie/${movie.id}`;
  }).join('\n\n');
}

async function searchMovies(query, apiKey) {
  const response = await axios.get(`${TMDB_BASE}/search/movie`, {
    timeout: 8000,
    params: {
      api_key: apiKey,
      query,
      include_adult: false,
      language: 'en-US',
      page: 1
    }
  });
  return Array.isArray(response.data?.results) ? response.data.results : [];
}

async function runJob(job) {
  const { socket, from, msg, query, footer, apiKey } = job;
  try {
    let results = cache.get(cacheKey(query));
    if (!results || results.expiresAt <= Date.now()) {
      results = { value: await searchMovies(query, apiKey), expiresAt: Date.now() + CACHE_TTL_MS };
      cache.set(cacheKey(query), results);
    }
    const body = results.value.length
      ? ['Official movie search results:', formatResults(results.value), 'Direct movie-file downloads are not provided. Use the official title pages above.']
      : [`No movie results found for: ${query}`];
    await socket.sendMessage(from, { text: body.join('\n\n') }, { quoted: msg });
  } catch (error) {
    console.error('movie search error:', error.stack || error);
    await socket.sendMessage(from, {
      text: `❌ Movie search failed: ${cleanText(error.message, 180)}\nTry again in a moment.`
    }, { quoted: msg }).catch(() => {});
  }
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active += 1;
    runJob(job)
      .catch(error => console.error('movie queue error:', error.stack || error))
      .finally(() => {
        active -= 1;
        pending.delete(job.key);
        pump();
      });
  }
}

function enqueue(job) {
  if (queue.length >= MAX_QUEUE) return false;
  queue.push(job);
  pending.set(job.key, true);
  pump();
  return true;
}

module.exports = {
  commands: ['movie', 'movies'],
  CACHE_TTL_MS,
  MAX_CONCURRENT,
  MAX_QUEUE,
  searchMovies,
  async run(ctx) {
    const { socket, from, msg, args, footer } = ctx;
    const query = args.join(' ').trim();
    if (!query) {
      await socket.sendMessage(from, {
        text: `🎬 *Movie Search*\nUsage: .movie <title>\nRequires TMDB_API_KEY on the server.`
      }, { quoted: msg });
      return;
    }

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      await socket.sendMessage(from, {
        text: '❌ Movie search is not configured. Add TMDB_API_KEY to the server environment.'
      }, { quoted: msg });
      return;
    }

    const key = `${from}:${cacheKey(query)}`;
    if (pending.has(key)) {
      await socket.sendMessage(from, { text: '⏳ That movie search is already queued.' }, { quoted: msg });
      return;
    }
    if (!enqueue({ key, socket, from, msg, query, footer, apiKey })) {
      await socket.sendMessage(from, { text: '⏳ Movie search queue is busy. Try again shortly.' }, { quoted: msg });
      return;
    }
    await socket.sendMessage(from, {
      text: `⏳ Searching movies for “${cleanText(query, 100)}”… Results will arrive when ready.`
    }, { quoted: msg });
  }
};
