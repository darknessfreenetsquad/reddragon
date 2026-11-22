'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getSongs } = require('../plugins/omegatech-music');

test('Omegatech music results require valid YouTube IDs and canonicalize URLs', () => {
  const songs = getSongs({
    topResult: { title: 'Top', url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK' },
    songs: [
      { title: 'Invalid empty ID', videoId: '', url: 'https://www.youtube.com/watch?v=' },
      { title: 'Valid duplicate', videoId: 'ABCDEFGHIJK', url: 'https://youtu.be/ABCDEFGHIJK' },
      { title: 'Valid parsed', url: 'https://www.youtube.com/watch?v=LMNOPQRSTUV' }
    ]
  });

  assert.deepEqual(songs.map(song => song.videoId), ['ABCDEFGHIJK', 'LMNOPQRSTUV']);
  assert.equal(songs[1].url, 'https://www.youtube.com/watch?v=LMNOPQRSTUV');
});
