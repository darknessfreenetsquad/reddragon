'use strict';

const axios = require('axios');
const { redDragon } = require('../lib/response-style');

const API_URL = process.env.OMEGATECH_MUSIC_API_URL || 'https://api.omegatech.app/api/download/play';
const TIMEOUT = 20000;

function clean(value, fallback = 'Unknown') {
  return String(value || fallback).replace(/[\r\n]+/g, ' ').trim();
}

function getSongs(data) {
  const songs = Array.isArray(data?.songs) ? data.songs : [];
  const top = data?.topResult;

  if (top?.videoId && !songs.some(song => song.videoId === top.videoId)) {
    songs.unshift({
      videoId: top.videoId,
      title: top.title,
      artist: top.subtitles?.[1] || 'Unknown',
      duration: top.subtitles?.[2] || '',
      url: top.url,
      thumbnails: top.thumbnails
    });
  }

  return songs
    .filter(song => song?.videoId && song?.url)
    .slice(0, 10);
}

async function searchOmegatechMusic(query) {
  const { data, status } = await axios.get(API_URL, {
    timeout: TIMEOUT,
    params: {
      action: 'search',
      query,
      format: 'mp3'
    }
  });

  if (
    status >= 400 ||
    data?.success === false ||
    data?.statusCode >= 400
  ) {
    throw new Error(data?.message || 'Omegatech search failed.');
  }

  return getSongs(data?.data || data);
}

function formatSongs(query, songs) {
  if (!songs.length) {
    return ['No songs found. Try another search.'];
  }

  return [
    `Search: ${query}`,
    '',
    ...songs.map((song, index) => {
      const duration = song.duration ? ` | ${song.duration}` : '';

      return [
        `${index + 1}. ${clean(song.title)}`,
        `Artist: ${clean(song.artist)}${duration}`,
        song.url
      ].join('\n');
    })
  ];
}

module.exports = {
  commands: ['omegamus', 'omegasearch'],

  searchOmegatechMusic,

  async run(ctx) {
    const { socket, from, msg, args, footer } = ctx;
    const query = args.join(' ').trim();

    if (!query) {
      await socket.sendMessage(from, {
        text: redDragon('OMEGATECH MUSIC SEARCH', [
          'Usage: .omegamus <song or artist>',
          'Example: .omegamus Alone'
        ], footer)
      }, { quoted: msg });
      return;
    }

    try {
      await socket.sendMessage(from, {
        react: { text: '🎵', key: msg.key }
      });

      const songs = await searchOmegatechMusic(query.slice(0, 200));

      await socket.sendMessage(from, {
        text: redDragon(
          'OMEGATECH MUSIC RESULTS',
          formatSongs(query, songs),
          footer
        )
      }, { quoted: msg });
    } catch (error) {
      console.error('Omegatech music plugin error:', error.message);

      await socket.sendMessage(from, {
        text: redDragon('OMEGATECH MUSIC ERROR', [
          error.response?.status ? `HTTP: ${error.response.status}` : '',
          error.message || 'Search failed. Try again later.'
        ].filter(Boolean), footer)
      }, { quoted: msg });
    }
  }
};
