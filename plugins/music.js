'use strict';

const axios = require('axios');
const { redDragon } = require('../lib/response-style');

const AUDIUS_API_BASE = process.env.AUDIUS_API_BASE || 'https://api.audius.co/v1';
const SOUNDCLOUD_API_BASE = 'https://api.soundcloud.com';
const SOUNDCLOUD_AUTH_BASE = 'https://secure.soundcloud.com';
const APPLE_MUSIC_STOREFRONT = process.env.APPLE_MUSIC_STOREFRONT || 'us';
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MEDIA_TOKEN_TTL = 10 * 60 * 1000;
const pendingMedia = new Map();

class ProviderUnavailable extends Error {}

function cleanText(value, fallback = 'Unknown') {
  return String(value || fallback).replace(/[\r\n]+/g, ' ').trim();
}

function sourceUrl(provider, track, explicitUrl = '') {
  const raw = String(explicitUrl || track.permalink || track.permalink_url || track.shareurl || track.url || '').trim();
  if (/^https:\/\//i.test(raw)) return raw;
  if (provider === 'audius') {
    if (raw.startsWith('/')) return `https://audius.co${raw}`;
    return `https://audius.co/${track.slug || `track/${track.id}`}`;
  }
  if (provider === 'soundcloud') return raw || `https://soundcloud.com/tracks/${track.id}`;
  if (provider === 'jamendo') return raw || `https://www.jamendo.com/track/${track.id}`;
  return raw || null;
}

function result(provider, track, fields = {}) {
  return {
    provider,
    id: String(track.id || track.track_id || track.song_id || ''),
    title: cleanText(fields.title || track.title || track.name, `${provider} track`),
    artist: cleanText(fields.artist || track.artist || track.artist_name || track.user?.name || track.user?.username || track.attributes?.artistName, provider),
    duration: Number.isFinite(track.duration) ? track.duration : null,
    url: sourceUrl(provider, track, fields.url),
    audioUrl: fields.audioUrl || null,
    audioHeaders: fields.audioHeaders || {},
    preview: fields.preview === true,
    artwork: fields.artwork || track.artwork?.['480x480'] || track.image || track.album?.images?.[0]?.url || track.attributes?.artwork?.url || null
  };
}

async function searchAudius(query) {
  const { data } = await axios.get(`${AUDIUS_API_BASE}/tracks/search`, { timeout: 15000, params: { query, limit: 1 } });
  const track = data?.data?.[0];
  const trackId = track?.id || track?.track_id;
  if (!trackId) return null;
  return result('audius', track, {
    audioUrl: `${AUDIUS_API_BASE}/tracks/${encodeURIComponent(trackId)}/stream`
  });
}

async function getSoundCloudToken() {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new ProviderUnavailable('SoundCloud credentials are not configured.');
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' }).toString();
  const { data } = await axios.post(`${SOUNDCLOUD_AUTH_BASE}/oauth/token`, body, {
    timeout: 15000,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` }
  });
  if (!data?.access_token) throw new Error('SoundCloud did not return an access token.');
  return data.access_token;
}

async function searchSoundCloud(query) {
  const token = await getSoundCloudToken();
  const { data } = await axios.get(`${SOUNDCLOUD_API_BASE}/tracks`, {
    timeout: 15000,
    headers: { Authorization: `OAuth ${token}` },
    params: { q: query, access: 'playable', limit: 1 }
  });
  const track = Array.isArray(data) ? data[0] : data?.collection?.[0];
  if (!track?.id) return null;
  return result('soundcloud', track, {
    audioUrl: track.stream_url || `${SOUNDCLOUD_API_BASE}/tracks/${track.id}/stream`,
    audioHeaders: { Authorization: `OAuth ${token}` }
  });
}

async function searchJamendo(query) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) throw new ProviderUnavailable('Jamendo client ID is not configured.');
  const { data } = await axios.get('https://api.jamendo.com/v3.0/tracks/', {
    timeout: 15000,
    params: { client_id: clientId, format: 'json', search: query, limit: 1, audioformat: 'mp32' }
  });
  const track = data?.results?.[0];
  if (!track?.id) return null;
  const allowed = track.audiodownload_allowed !== false;
  return result('jamendo', track, { audioUrl: allowed ? (track.audio || track.audiodownload) : null });
}

async function getSpotifyToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new ProviderUnavailable('Spotify credentials are not configured.');
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' }).toString();
  const { data } = await axios.post('https://accounts.spotify.com/api/token', body, {
    timeout: 15000,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!data?.access_token) throw new Error('Spotify did not return an access token.');
  return data.access_token;
}

async function searchSpotify(query) {
  const token = await getSpotifyToken();
  const { data } = await axios.get('https://api.spotify.com/v1/search', {
    timeout: 15000,
    headers: { Authorization: `Bearer ${token}` },
    params: { q: query, type: 'track', limit: 1 }
  });
  const track = data?.tracks?.items?.[0];
  if (!track?.id) return null;
  return result('spotify', track, {
    title: track.name,
    artist: track.artists?.[0]?.name,
    url: track.external_urls?.spotify,
    audioUrl: track.preview_url || null,
    preview: Boolean(track.preview_url),
    artwork: track.album?.images?.[0]?.url
  });
}

async function searchAppleMusic(query) {
  const token = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  if (!token) throw new ProviderUnavailable('Apple Music developer token is not configured.');
  const { data } = await axios.get(`https://api.music.apple.com/v1/catalog/${encodeURIComponent(APPLE_MUSIC_STOREFRONT)}/search`, {
    timeout: 15000,
    headers: { Authorization: `Bearer ${token}` },
    params: { term: query, types: 'songs', limit: 1 }
  });
  const track = data?.results?.songs?.data?.[0];
  if (!track?.id) return null;
  const attributes = track.attributes || {};
  return result('applemusic', track, {
    title: attributes.name,
    artist: attributes.artistName,
    url: attributes.url,
    audioUrl: attributes.previews?.[0]?.url || null,
    preview: Boolean(attributes.previews?.[0]?.url),
    artwork: attributes.artwork?.url
  });
}

const PROVIDERS = {
  audius: searchAudius,
  soundcloud: searchSoundCloud,
  jamendo: searchJamendo,
  spotify: searchSpotify,
  applemusic: searchAppleMusic
};
const PROVIDER_ORDER = Object.keys(PROVIDERS);

function providerConfigured(name) {
  if (name === 'soundcloud') return Boolean(process.env.SOUNDCLOUD_CLIENT_ID && process.env.SOUNDCLOUD_CLIENT_SECRET);
  if (name === 'jamendo') return Boolean(process.env.JAMENDO_CLIENT_ID);
  if (name === 'spotify') return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
  if (name === 'applemusic') return Boolean(process.env.APPLE_MUSIC_DEVELOPER_TOKEN);
  return true;
}

async function searchMusic(query, requestedProvider = '') {
  const collected = await collectMusicResults(query, requestedProvider);
  return { item: collected.items[0] || null, failures: collected.failures };
}

async function collectMusicResults(query, requestedProvider = '') {
  const phrase = String(query || '').trim();
  if (!phrase) throw new Error('Enter a song or artist name.');
  const names = requestedProvider ? [requestedProvider] : PROVIDER_ORDER.filter(providerConfigured);
  const failures = [];
  const items = [];
  const results = await Promise.all(names.map(async name => {
    try {
      return { name, item: await PROVIDERS[name](phrase), error: null };
    } catch (error) {
      return { name, item: null, error };
    }
  }));
  for (const result of results) {
    if (result.item) items.push(result.item);
    if (result.error) failures.push(`${result.name}: ${result.error.message}`);
  }
  return { items, failures };
}

async function downloadAudio(item) {
  if (!item.audioUrl) return null;
  const response = await axios.get(item.audioUrl, {
    timeout: 45000,
    responseType: 'arraybuffer',
    maxContentLength: MAX_AUDIO_BYTES,
    maxBodyLength: MAX_AUDIO_BYTES,
    headers: item.audioHeaders
  });
  const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw new Error('Provider returned an invalid or oversized audio file.');
  return buffer;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown length';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function captionFor(item, title = 'MUSIC') {
  return redDragon(title, [
    `Provider: ${item.provider.toUpperCase()}`,
    `Title: ${item.title}`,
    `Artist: ${item.artist}`,
    `Length: ${formatDuration(item.duration)}`,
    item.preview ? 'Type: official preview' : 'Type: provider stream',
    item.url ? `Source: ${item.url}` : ''
  ]);
}

function rememberMedia(item) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  pendingMedia.set(token, { item, expiresAt: Date.now() + MEDIA_TOKEN_TTL });
  for (const [key, value] of pendingMedia) {
    if (value.expiresAt < Date.now()) pendingMedia.delete(key);
  }
  return token;
}

function getRememberedMedia(token) {
  const entry = pendingMedia.get(String(token || ''));
  if (!entry || entry.expiresAt < Date.now()) {
    if (token) pendingMedia.delete(String(token));
    return null;
  }
  return entry.item;
}

async function sendMediaChoice(ctx, item) {
  const { socket, from, msg } = ctx;
  const buffer = await downloadAudio(item);
  await socket.sendMessage(from, {
    audio: buffer,
    mimetype: 'audio/mpeg',
    ptt: false,
    caption: captionFor(item, 'MUSIC AUDIO')
  }, { quoted: msg });
}

module.exports = {
  commands: ['music', 'audius', 'soundcloud', 'jamendo', 'spotify', 'applemusic', 'musicaudio', 'musicdoc'],
  hiddenCommands: ['musicaudio', 'musicdoc'],
  PROVIDER_ORDER,
  searchAudius,
  searchSoundCloud,
  searchJamendo,
  searchSpotify,
  searchAppleMusic,
  searchMusic,
  collectMusicResults,
  downloadAudio,
  async run(ctx) {
    const { socket, from, msg, args, footer, command } = ctx;
    if (command === 'musicaudio' || command === 'musicdoc') {
      const item = getRememberedMedia(args[0]);
      if (!item) {
        await socket.sendMessage(from, { text: redDragon('MUSIC BUTTON', ['This media button has expired. Run .music again.'], footer) }, { quoted: msg });
        return;
      }
      try {
        const buffer = await downloadAudio(item);
        const caption = captionFor(item, command === 'musicdoc' ? 'MUSIC DOCUMENT' : 'MUSIC AUDIO');
        if (command === 'musicdoc') {
          await socket.sendMessage(from, {
            document: buffer,
            mimetype: 'audio/mpeg',
            fileName: `${item.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'red-mini-music'}.mp3`,
            caption
          }, { quoted: msg });
        } else {
          await socket.sendMessage(from, { audio: buffer, mimetype: 'audio/mpeg', ptt: false, caption }, { quoted: msg });
        }
      } catch (error) {
        await socket.sendMessage(from, { text: redDragon('MUSIC MEDIA ERROR', [error.message, 'Try .music again for another provider.'], footer) }, { quoted: msg });
      }
      return;
    }
    if (!args.length) {
      await socket.sendMessage(from, { text: redDragon('MUSIC SEARCH', [
        'Usage: .music <song or artist>',
        'Providers: Audius, SoundCloud, Jamendo, Spotify, Apple Music'
      ], footer) }, { quoted: msg });
      return;
    }

    await socket.sendMessage(from, { react: { text: '🎵', key: msg.key } });
    const provider = command === 'music' ? '' : command;
    try {
      const search = await collectMusicResults(args.join(' '), provider);
      if (!search.items.length) {
        await socket.sendMessage(from, { text: redDragon('MUSIC SEARCH', [
          'No result could be found.',
          ...search.failures.slice(0, 3)
        ], footer) }, { quoted: msg });
        return;
      }

      let linkItem = null;
      for (const item of search.items) {
        if (!item.audioUrl) {
          linkItem ||= item;
          continue;
        }
        try {
          await sendMediaChoice(ctx, item);
          return;
        } catch (mediaError) {
          console.error(`${item.provider} media error:`, mediaError.message);
          search.failures.push(`${item.provider}: media fetch failed`);
        }
      }

      const item = linkItem || search.items[0];
      const reason = item.preview ? 'Only an official preview is available.' : 'This provider returned metadata/link access only.';
      await socket.sendMessage(from, { text: redDragon('MUSIC LINK', [
        `Provider: ${item.provider}`,
        `Title: ${item.title}`,
        `Artist: ${item.artist}`,
        reason,
        item.url ? `Open: ${item.url}` : ''
      ], footer) }, { quoted: msg });
    } catch (error) {
      console.error(`${command} plugin error:`, error.message);
      await socket.sendMessage(from, { text: redDragon('MUSIC ERROR', [error.message], footer) }, { quoted: msg });
    }
  }
};
