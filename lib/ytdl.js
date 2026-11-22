'use strict';

const APIs = require('./api');
const { searchYouTube: searchYouTubeWeb } = require('./youtube-search');

const YT_ID = /(?:youtube\.com\/(?:watch\?.*?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

function isYTUrl(value) {
  return YT_ID.test(String(value || '').trim());
}

function getVideoID(value) {
  const text = String(value || '').trim();
  const match = text.match(YT_ID) || text.match(/^([a-zA-Z0-9_-]{11})$/);
  if (!match) throw new Error('Not a YouTube URL or video ID');
  return match[1];
}

function watchUrl(value) {
  return `https://www.youtube.com/watch?v=${getVideoID(value)}`;
}

async function search(query, options = {}) {
  const result = await searchYouTubeWeb(query, options);
  return result.videos || [];
}

async function searchTrack(query) {
  const videos = await search(query);
  return videos.map(video => ({
    isYtMusic: true,
    title: video.title,
    artist: video.author?.name || video.author?.channelTitle || 'Unknown artist',
    id: video.videoId,
    url: video.url,
    album: null,
    duration: { seconds: video.seconds || 0, label: video.timestamp || '' },
    image: video.thumbnail || null
  }));
}

async function resolveVideo(query) {
  if (isYTUrl(query) || /^[a-zA-Z0-9_-]{11}$/.test(String(query || '').trim())) {
    const id = getVideoID(query);
    const results = await search(id);
    return results[0] || { videoId: id, url: watchUrl(id), title: 'YouTube Audio' };
  }
  const results = await search(query);
  if (!results.length) throw new Error('No YouTube results found.');
  return results[0];
}

async function getAudio(url) {
  const providers = [
    APIs.knightSongDownload,
    APIs.hectorSongDownload,
    APIs.princeSongDownload,
    APIs.prexzySongDownload,
    APIs.getEliteProTechDownloadByUrl,
    APIs.getYupraDownloadByUrl,
    APIs.getOkatsuDownloadByUrl,
    APIs.getIzumiDownloadByUrl
  ];
  let lastError;
  for (const provider of providers) {
    try {
      const result = await provider(url);
      if (result?.download && /^https?:\/\//i.test(result.download)) return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('All YouTube audio providers failed.');
}

async function mp3(query, metadata = {}) {
  const video = await resolveVideo(query);
  const result = await getAudio(video.url);
  return {
    meta: { title: result.title || video.title, channel: video.author?.name || '', image: result.thumbnail || video.thumbnail || null, ...metadata },
    path: null,
    url: result.download,
    size: null
  };
}

async function downloadMusic(query) {
  return mp3(query);
}

async function mp4(query, quality = '720p') {
  const video = await resolveVideo(query);
  const providers = [
    () => APIs.knightVideoDownload(video.url, quality),
    () => APIs.princeVideoDownload(video.url, quality),
    () => APIs.hectorVideoDownload(video.url, quality)
  ];
  let lastError;
  for (const provider of providers) {
    try {
      const result = await provider();
      if (result?.download && /^https?:\/\//i.test(result.download)) {
        return { ...result, title: result.title || video.title, sourceUrl: video.url, videoUrl: result.download };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('All YouTube video providers failed.');
}

module.exports = { isYTUrl, getVideoID, search, searchTrack, resolveVideo, mp3, downloadMusic, mp4 };
