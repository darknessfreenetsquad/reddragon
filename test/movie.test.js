'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const movie = require('../plugins/movie');

const originalGet = axios.get;
after(() => {
  axios.get = originalGet;
  delete process.env.TMDB_API_KEY;
});

function context(args = ['Dune']) {
  return {
    args,
    from: '12345678901@s.whatsapp.net',
    msg: { key: { remoteJid: '12345678901@s.whatsapp.net' } },
    socket: { sent: [], async sendMessage(to, message, options) { this.sent.push({ to, message, options }); } }
  };
}

test('movie command gives a clear response when unconfigured', async () => {
  delete process.env.TMDB_API_KEY;
  const ctx = context();
  await movie.run(ctx);
  assert.match(ctx.socket.sent[0].message.text, /TMDB_API_KEY/);
});

test('movie search uses a short API request and returns official title links', async () => {
  process.env.TMDB_API_KEY = 'test-key';
  let request;
  axios.get = async (url, options) => {
    request = { url, options };
    return { data: { results: [{ id: 438631, title: 'Dune', release_date: '2021-10-22', vote_average: 8.1, overview: 'A desert adventure.' }] } };
  };
  const result = await movie.searchMovies('Dune', process.env.TMDB_API_KEY);
  assert.equal(request.url, 'https://api.themoviedb.org/3/search/movie');
  assert.equal(request.options.timeout, 8000);
  assert.equal(result[0].id, 438631);

  const ctx = context();
  await movie.run(ctx);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(ctx.socket.sent.some(item => item.message.text?.includes('Searching movies')));
  assert.ok(ctx.socket.sent.some(item => item.message.text?.includes('themoviedb.org/movie/438631')));
});
