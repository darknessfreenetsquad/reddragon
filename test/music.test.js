'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const plugin = require('../plugins/music');

const originalGet = axios.get;
const originalPost = axios.post;
after(() => {
  axios.get = originalGet;
  axios.post = originalPost;
  for (const key of ['SOUNDCLOUD_CLIENT_ID', 'SOUNDCLOUD_CLIENT_SECRET', 'JAMENDO_CLIENT_ID', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'APPLE_MUSIC_DEVELOPER_TOKEN']) delete process.env[key];
});

function context(command = 'music', args = ['test', 'song']) {
  return {
    socket: { sent: [], async sendMessage(to, message, options) { this.sent.push({ to, message, options }); } },
    from: '12345678901@s.whatsapp.net',
    msg: { key: { remoteJid: '12345678901@s.whatsapp.net' } },
    command,
    args,
    prefix: '.',
    footer: 'footer'
  };
}

function track(overrides = {}) {
  return { id: 'track-123', title: 'Test Song', user: { name: 'Test Artist' }, duration: 187, permalink: '/test-artist/test-song', ...overrides };
}

test('Audius search maps the public result and clickable source URL', async () => {
  let request;
  axios.get = async (url, options) => {
    request = { url, options };
    return { data: { data: [track()] } };
  };
  const result = await plugin.searchAudius('test song');
  assert.equal(request.url, 'https://api.audius.co/v1/tracks/search');
  assert.deepEqual(request.options.params, { query: 'test song', limit: 1 });
  assert.equal(result.url, 'https://audius.co/test-artist/test-song');
  assert.equal(result.audioUrl, 'https://api.audius.co/v1/tracks/track-123/stream');
});

test('Audius search accepts the live track_id response field', async () => {
  axios.get = async () => ({ data: { data: [{ track_id: 880254, title: 'Live Track', user: { name: 'Artist' } }] } });
  const result = await plugin.searchAudius('live track');
  assert.equal(result.id, '880254');
  assert.equal(result.audioUrl, 'https://api.audius.co/v1/tracks/880254/stream');
});

test('all five providers are registered and old YouTube aliases are absent', () => {
  assert.deepEqual(plugin.commands, ['music', 'audius', 'soundcloud', 'jamendo', 'spotify', 'applemusic', 'musicaudio', 'musicdoc']);
  for (const alias of ['video', 'yta', 'ytv', 'ytmp3', 'ytmp4', 'play3', 'song2']) assert.equal(plugin.commands.includes(alias), false, alias);
  assert.deepEqual(plugin.PROVIDER_ORDER, ['audius', 'soundcloud', 'jamendo', 'spotify', 'applemusic']);
});

test('.music sends MP3 documents without button payloads', async () => {
  axios.get = async url => url.includes('/tracks/search')
    ? { data: { data: [track()] } }
    : { data: Buffer.from('fake-mp3-audio') };
  const ctx = context('music');
  await plugin.run(ctx);
  const message = ctx.socket.sent.at(-1).message;
  assert.ok(Buffer.isBuffer(message.document));
  assert.equal(message.mimetype, 'audio/mpeg');
  assert.equal(message.fileName, 'Test-Song.mp3');
  assert.equal(message.buttons, undefined);
});

test('.music falls back to Jamendo when Audius search has no result', async () => {
  process.env.JAMENDO_CLIENT_ID = 'jamendo-test';
  let calls = [];
  axios.get = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('audius.co/v1/tracks/search')) return { data: { data: [] } };
    if (url.includes('api.jamendo.com')) return { data: { results: [{ id: 'jam-9', name: 'Jam Song', artist_name: 'Jam Artist', duration: 200, shareurl: 'https://www.jamendo.com/track/jam-9', audio: 'https://cdn.jamendo.test/jam.mp3', audiodownload_allowed: true }] } };
    return { data: Buffer.from('jamendo-audio') };
  };
  const ctx = context('music');
  await plugin.run(ctx);
  const message = ctx.socket.sent.at(-1).message;
  assert.ok(Buffer.isBuffer(message.document));
  assert.equal(message.fileName, 'Jam-Song.mp3');
  assert.equal(message.buttons, undefined);
  assert.match(message.caption, /JAMENDO/);
  assert.match(message.caption, /Jam Song/);
  assert.ok(calls.some(call => call.url.includes('api.jamendo.com')));
});

test('Spotify returns an official link when no preview audio exists', async () => {
  process.env.SPOTIFY_CLIENT_ID = 'spotify-id';
  process.env.SPOTIFY_CLIENT_SECRET = 'spotify-secret';
  axios.post = async () => ({ data: { access_token: 'spotify-token' } });
  axios.get = async (url) => ({ data: url.includes('spotify.com/v1/search') ? { tracks: { items: [{ id: 'sp-1', name: 'Spotify Song', artists: [{ name: 'Spotify Artist' }], external_urls: { spotify: 'https://open.spotify.com/track/sp-1' }, preview_url: null }] } } : {} });
  const ctx = context('spotify');
  await plugin.run(ctx);
  const message = ctx.socket.sent.at(-1).message;
  assert.match(message.text, /MUSIC LINK/);
  assert.match(message.text, /https:\/\/open\.spotify\.com\/track\/sp-1/);
});

test('Apple Music maps an official preview when one is returned', async () => {
  process.env.APPLE_MUSIC_DEVELOPER_TOKEN = 'apple-token';
  axios.get = async () => ({ data: { results: { songs: { data: [{ id: 'apple-1', attributes: { name: 'Apple Song', artistName: 'Apple Artist', url: 'https://music.apple.com/us/song/apple-1', previews: [{ url: 'https://cdn.apple.test/preview.m4a' }], artwork: { url: 'https://cdn.apple.test/{w}x{h}.jpg' } } }] } } } });
  const result = await plugin.searchAppleMusic('apple song');
  assert.equal(result.preview, true);
  assert.equal(result.audioUrl, 'https://cdn.apple.test/preview.m4a');
  assert.equal(result.url, 'https://music.apple.com/us/song/apple-1');
});
