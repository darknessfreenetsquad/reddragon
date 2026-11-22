'use strict';

const axios = require('axios');
const { redDragon, cleanFileName } = require('../lib/response-style');
const { downloadPlayAudio } = require('./omega');

const API_URL = process.env.OMEGATECH_MUSIC_API_URL || 'https://api.omegatech.app/api/download/play';
const TIMEOUT = 20000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const searchCache = new Map();

function clean(value, fallback = 'Unknown') {
  return String(value || fallback).replace(/[\r\n]+/g, ' ').trim();
}

function getSongs(data) {
  const songs = Array.isArray(data?.songs) ? [...data.songs] : [];
  const top = data?.topResult;

  if (top?.videoId && !songs.some(song => song.videoId === top.videoId)) {
    songs.unshift({
      videoId: top.videoId,
      title: top.title,
      artist: top.subtitles?.[1] || 'Unknown',
      url: top.url,
      thumbnails: top.thumbnails
    });
  }

  return songs.filter(song => song?.videoId && song?.url).slice(0, 10);
}

async function searchMusic(query) {
  const { data, status } = await axios.get(API_URL, {
    timeout: TIMEOUT,
    params: { action: 'search', query, format: 'mp3' }
  });

  if (status >= 400 || data?.success === false) {
    throw new Error(data?.message || 'Music search failed.');
  }

  return getSongs(data?.data || data);
}

function formatResults(query, songs) {
  if (!songs.length) return ['No songs found.'];

  return [
    `Search: ${query}`,
    '',
    ...songs.slice(0, 5).map((song, i) => [
      `${i + 1}. ${clean(song.title)}`,
      `Artist: ${clean(song.artist)}`,
      song.url
    ].join('\n'))
  ];
}

function fileName(title) {
  return cleanFileName(`${clean(title, 'red-mini-song')}.mp3`, 'red-mini-song.mp3');
}

async function downloadBuffer(url) {
  const response = await axios.get(url, {
    timeout: 60000,
    responseType: 'arraybuffer',
    maxContentLength: MAX_AUDIO_BYTES,
    maxBodyLength: MAX_AUDIO_BYTES,
    validateStatus: status => status >= 200 && status < 300
  });

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error('The downloaded audio file is empty.');
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('Audio exceeds the 20 MB limit.');
  return buffer;
}

module.exports = {
  commands: ['omegamus', 'omegasearch', 'omegadoc'],

  searchMusic,

  async run(ctx) {
    const { socket, from, msg, args, command, footer } = ctx;
    const input = args.join(' ').trim();

    if (!input) {
      await socket.sendMessage(from, {
        text: redDragon('OMEGATECH MUSIC', [
          '.omegamus <song name> — Search songs',
          '.omegadoc <song name> — Send first result as MP3 document',
          '.omegadoc 2 — Send second result from previous search'
        ], footer)
      }, { quoted: msg });
      return;
    }

    try {
      await socket.sendMessage(from, {
        react: { text: command === 'omegadoc' ? '📥' : '🎵', key: msg.key }
      });

      let songs;
      let selected;
      if (command === 'omegadoc' && /^\d+$/.test(input)) {
        songs = searchCache.get(from);
        if (!songs) throw new Error('No saved search. Search songs first with .omegamus.');
        selected = songs[Number(input) - 1];
        if (!selected) throw new Error('That result number is not available.');
      } else {
        songs = await searchMusic(input.slice(0, 200));
        searchCache.set(from, songs);
        selected = songs[0];

        if (!songs.length) {
          await socket.sendMessage(from, {
            text: redDragon('MUSIC SEARCH', ['No songs found. Try another name.'], footer)
          }, { quoted: msg });
          return;
        }

        if (command !== 'omegadoc') {
          await socket.sendMessage(from, {
            text: redDragon('OMEGATECH MUSIC RESULTS', formatResults(input, songs), footer)
          }, { quoted: msg });
          return;
        }
      }

      await socket.sendMessage(from, {
        text: redDragon('MUSIC DOWNLOAD', [
          `Title: ${clean(selected.title)}`,
          `Artist: ${clean(selected.artist)}`,
          'Downloading audio document...'
        ], footer)
      }, { quoted: msg });

      const audio = await downloadPlayAudio(selected.url);
      if (!audio?.downloadUrl) throw new Error('No audio download link was returned.');
      const buffer = await downloadBuffer(audio.downloadUrl);

      await socket.sendMessage(from, {
        document: buffer,
        mimetype: 'audio/mpeg',
        fileName: fileName(selected.title),
        caption: redDragon('SONG DOCUMENT', [
          `Title: ${clean(selected.title)}`,
          `Artist: ${clean(selected.artist)}`,
          'Downloaded via Omegatech'
        ], footer)
      }, { quoted: msg });
    } catch (error) {
      console.error('Omegatech music document error:', error.message);
      await socket.sendMessage(from, {
        text: redDragon('MUSIC DOWNLOAD FAILED', [error.message || 'Unable to download this song.'], footer)
      }, { quoted: msg });
    }
  }
};
