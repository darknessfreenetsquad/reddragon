'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const games = require('../plugins/games');
const social = require('../plugins/social-downloaders');
const universal = require('../plugins/download');
const omega = require('../plugins/omega');
const { loadPlugins } = require('../plugin-loader');

const originalGet = axios.get;
const originalPost = axios.post;
const originalSearchYouTube = omega.searchYouTube;
const originalDownloadPlayAudio = omega.downloadPlayAudio;
after(() => {
  axios.get = originalGet;
  axios.post = originalPost;
  omega.searchYouTube = originalSearchYouTube;
  omega.downloadPlayAudio = originalDownloadPlayAudio;
});

function ctx(command, args = []) {
  return {
    socket: { sent: [], async sendMessage(to, message) { this.sent.push(message); } },
    from: '12345678901@s.whatsapp.net', msg: { key: { remoteJid: '12345678901@s.whatsapp.net' } },
    command, args, prefix: '.', footer: '© Red Dragon DFS', botName: 'Red Mini', ownerNumber: 'Not configured', getUptime: () => 12
  };
}

test('plugin loader exposes migrated non-menu commands', () => {
  const registry = loadPlugins();
  for (const command of ['play', 'music', 'audius', 'soundcloud', 'jamendo', 'spotify', 'applemusic', 'songsearch', 'findsong', 'trending', 'audiomacktrending', 'ceenaija', 'anime', 'crunchyroll', 'ytdl', 'ytvideo', 'ytaudio', 'kick', 'kickall', 'tgstickers', 'mute', 'open', 'adddescription', 'addstgroup', 'addstchannel', 'converctor', 'converter', 'to-url', 'to-doc', 'to-music', 'to-sticker', 'update', 'statusview', 'download', 'movie', 'movies', 'truth', 'dare', 'rps', 'facebook', 'instagram', 'tiktok', 'twitter', 'imagetheme', 'setimage']) {
    assert.ok(registry.has(command), command);
  }
  for (const command of ['video', 'ytmp3', 'ytmp4', 'ytmpdoc', 'yta', 'ytv', 'play3', 'song2']) {
    assert.equal(registry.has(command), false, `${command} should be removed`);
  }
  assert.ok(registry.has('menu'), 'existing menu plugin remains available');
});

test('games use compact RedDragon formatting and validate rps', async () => {
  const truth = ctx('truth'); await games.run(truth);
  assert.match(truth.socket.sent[0].text, /𝙍𝙀𝘿 𝙓𝙈𝘿/);
  const rps = ctx('rps', ['invalid']); await games.run(rps);
  assert.match(rps.socket.sent[0].text, /Choose: rock/);
});

test('every registered plugin command alias has a safe local smoke path', async () => {
  const registry = loadPlugins();
  for (const command of registry.keys()) {
    const commandContext = ctx(command);
    if (['trending', 'audiomacktrending'].includes(command)) commandContext.skipNetwork = true;
    await registry.get(command).run(commandContext);
    assert.ok(commandContext.socket.sent.length > 0, `${command} produced no response`);
  }
});

test('social and universal downloader plugins validate URLs and send API media', async () => {
  axios.post = async (url, body) => {
    assert.match(url, /api\.omegatech\.app\/api\/download\/Facebook/);
    assert.equal(body.action, 'resolve');
    return { data: { directUrl: 'https://cdn.test/facebook.mp4' } };
  };
  axios.get = async (url, options = {}) => {
    if (options.responseType === 'arraybuffer') {
      return { data: Buffer.from('mock-video'), headers: { 'content-type': 'video/mp4' } };
    }
    return url.includes('/api/download/facebook')
      ? { data: { success: true, data: { directUrl: 'https://cdn.test/social.mp4' } } }
      : url.includes('omegatech')
        ? { data: { success: true, result: { video: [{ url: 'https://cdn.test/all.mp4' }] } } }
        : { data: { result: { hd: 'https://cdn.test/social.mp4' } } };
  };
  const socialCtx = ctx('facebook', ['https://facebook.com/test']); await social.run(socialCtx);
  assert.deepEqual(socialCtx.socket.sent.at(-1).video, Buffer.from('mock-video'));
  assert.equal(socialCtx.socket.sent.at(-1).mimetype, 'video/mp4');
  assert.match(socialCtx.socket.sent.at(-1).caption, /𝙍𝙀𝘿 𝙓𝙈𝘿/);
  const universalCtx = ctx('download', ['https://example.com/test']); await universal.run(universalCtx);
  assert.deepEqual(universalCtx.socket.sent.at(-1).document, Buffer.from('mock-video'));
  assert.equal(universalCtx.socket.sent.at(-1).mimetype, 'video/mp4');
});

test('downloaders reject empty, oversized, HTML, and JSON provider responses', () => {
  const validators = [universal.validateMediaResponse, social.validateMediaResponse];
  for (const validate of validators) {
    assert.deepEqual(validate({ data: Buffer.from('media'), headers: { 'content-type': 'video/mp4; charset=binary' } }), {
      buffer: Buffer.from('media'),
      mime: 'video/mp4'
    });
    assert.throws(() => validate({ data: Buffer.alloc(0), headers: {} }), /empty file/);
    assert.throws(() => validate({ data: Buffer.alloc(6), headers: {} }, 5), /exceeds the size limit/);
    assert.throws(() => validate({ data: Buffer.from('<html>error</html>'), headers: { 'content-type': 'text/html' } }), /error page/);
    assert.throws(() => validate({ data: Buffer.from('{}'), headers: { 'content-type': 'application/json; charset=utf-8' } }), /error page/);
  }
});

test('Facebook downloader maps Omegatech data.directUrl responses', async () => {
  axios.post = async (url, body) => {
    assert.match(url, /api\.omegatech\.app\/api\/download\/Facebook/);
    assert.deepEqual(body, { action: 'resolve', url: 'https://facebook.com/new-format', quality: 'hd' });
    return { data: { directUrl: 'https://cdn.test/omegatech.mp4' } };
  };
  axios.get = async (url, options) => {
    if (options?.responseType === 'arraybuffer') {
      return { data: Buffer.from('mock-facebook'), headers: { 'content-type': 'video/mp4' } };
    }
    assert.match(url, /api\.omegatech\.app\/api\/download\/facebook/);
    assert.deepEqual(options.params, { action: 'download', url: 'https://facebook.com/new-format' });
    assert.equal(options.timeout, 15000);
    return { data: { success: true, data: { videoId: '123', quality: 'hd', directUrl: 'https://cdn.test/omegatech.mp4' } } };
  };
  const socialCtx = ctx('facebook', ['https://facebook.com/new-format']);
  await social.run(socialCtx);
  assert.deepEqual(socialCtx.socket.sent.at(-1).video, Buffer.from('mock-facebook'));
});

test('Omegatech commands map search, trending, anime, and YouTube metadata safely', async () => {
  axios.get = async (url, options) => {
    assert.equal(options.timeout, 15000);
    if (url.includes('searchthatsong')) return { data: { success: true, data: { song: 'Unethical', artist: 'Faouzia', relevantChunk: 'Isn\'t it a bit unethical?', youtubeUrl: 'https://youtube.com/watch?v=test' } } };
    if (url.includes('audiomack')) return { data: { success: true, data: { count: 1, items: [{ title: 'Somebody', artist: 'Trei', pageUrl: 'https://audiomack.com/trei/song/somebody' }] } } };
    if (url.includes('Crunchyroll')) return { data: { success: true, data: { query: 'Naruto', results: [{ title: 'Naruto', type: 'series', crId: 'GY9PJ5KWR', description: 'Ninja series' }] } } };
    if (url.includes('/download/YouTube')) return { data: { success: true, data: { title: 'Test video', channel: 'Test channel', durationLabel: '1:00', url: 'https://youtu.be/test', videoFormats: [{ label: '360p', sizeBytes: 1000000, sizeLabel: '1 MB', downloadUrl: 'https://cdn.test/test.mp4' }] } } };
    throw new Error(`Unexpected URL: ${url}`);
  };

  const song = ctx('songsearch', ['It', 'unethical']); await omega.run(song);
  assert.match(song.socket.sent.at(-1).text, /Faouzia/);
  const trend = ctx('trending'); await omega.run(trend);
  assert.match(trend.socket.sent.at(-1).text, /Somebody/);
  const anime = ctx('anime', ['Naruto']); await omega.run(anime);
  assert.match(anime.socket.sent.at(-1).text, /GY9PJ5KWR/);
  const youtube = ctx('ytdl', ['https://youtu.be/test']); await omega.run(youtube);
  assert.match(youtube.socket.sent.at(-1).text, /Test video/);
});

test('play reports missing queries and empty YouTube results in Red Dragon text', async () => {
  const missing = ctx('play');
  await omega.run(missing);
  assert.match(missing.socket.sent.at(-1).text, /What song do you want to download/);

  omega.searchYouTube = async () => ({ videos: [] });
  const empty = ctx('play', ['unknown song']);
  await omega.run(empty);
  assert.match(empty.socket.sent.at(-1).text, /No songs found/);
  assert.match(empty.socket.sent.at(-1).text, /𝙍𝙀𝘿 𝙓𝙈𝘿/);
});

test('play searches YouTube, calls Keith MP3, and sanitizes the returned filename', async () => {
  const calls = [];
  omega.searchYouTube = async query => {
    assert.equal(query, 'Alan Walker');
    return { videos: [{ title: 'Search result', url: 'https://www.youtube.com/watch?v=music-123' }] };
  };
  omega.downloadPlayAudio = async url => {
    calls.push(url);
    return { title: 'Song: Test/Unsafe?', downloadUrl: 'https://cdn.test/test-song.mp3' };
  };
  omega.downloadAudioBuffer = async url => {
    assert.equal(url, 'https://cdn.test/test-song.mp3');
    return Buffer.from('mock-mp3');
  };

  const play = ctx('play', ['Alan', 'Walker']);
  await omega.run(play);
  const message = play.socket.sent.at(-1);
  assert.deepEqual(message.document, Buffer.from('mock-mp3'));
  assert.equal(message.mimetype, 'audio/mpeg');
  assert.equal(message.fileName, 'Song_ Test_Unsafe_.mp3');
  assert.match(message.caption, /PLAY DOWNLOAD/);
  assert.match(message.caption, /Format: MP3/);
  assert.deepEqual(calls, ['https://www.youtube.com/watch?v=music-123']);
});

test('play reports invalid Keith responses and download failures', async () => {
  omega.searchYouTube = async () => ({ videos: [{ url: 'https://youtu.be/music-789' }] });
  omega.downloadPlayAudio = async () => {
    throw new Error('Failed to fetch audio from the API. Please try again later.');
  };
  const invalid = ctx('play', ['invalid']);
  await omega.run(invalid);
  assert.match(invalid.socket.sent.at(-1).text, /Failed to fetch audio from the API/);

  omega.downloadPlayAudio = async () => { throw new Error('timeout'); };
  const failed = ctx('play', ['timeout']);
  await omega.run(failed);
  assert.match(failed.socket.sent.at(-1).text, /Download failed/);
});

test('Omegatech YouTube video command enforces the 50 MB limit', async () => {
  axios.get = async () => ({ data: { success: true, data: { title: 'Large video', channel: 'Test', durationLabel: '1:00', videoFormats: [{ label: '1080p', sizeBytes: 100000000, sizeLabel: '100 MB', downloadUrl: 'https://cdn.test/large.mp4' }] } } });
  const video = ctx('ytvideo', ['https://youtu.be/large']); await omega.run(video);
  assert.match(video.socket.sent.at(-1).text, /50 MB/);
  assert.equal(video.socket.sent.at(-1).video, undefined);
});

test('YouTube video selection accepts alternate URL and size fields', () => {
  const selected = omega.chooseVideo([{ label: '360p', height: 360, sizeLabel: '26.8 MB', url: 'https://cdn.test/video.mp4' }]);
  assert.equal(selected.downloadUrl, 'https://cdn.test/video.mp4');
  assert.equal(selected.sizeBytes, 26.8 * 1024 * 1024);
});
