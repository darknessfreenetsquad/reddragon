'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const parse5 = require('parse5');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'red-mini-http-'));
const app = require('../index');
const server = app.listen(0);
after(() => server.close());
const request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);

test('both HTML documents parse without errors and their inline scripts compile', () => {
  for (const file of ['main.html', 'status.html']) {
    const html = fs.readFileSync(file, 'utf8');
    const errors = [];
    parse5.parse(html, { onParseError: error => errors.push(`${error.code} at ${error.startLine}:${error.startCol}`) });
    assert.deepEqual(errors, [], file);
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1], { filename: file }));
    }
    if (file === 'status.html') assert.doesNotMatch(html, /dashboardToken|createDashboardToken|\/code\/token/);
  }
});

test('frontend pages, redirect and status API are served', async () => {
  const redirect = await request('/', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/status');
  for (const path of ['/status', '/pair']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /<!DOCTYPE html>/i);
  }
  const response = await request('/api/status');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, 'online');
  assert.equal(data.database, 'local');
  assert.equal(data.activeSessions, 0);
  assert.deepEqual(data.sessions, []);
  assert.ok(data.uptime >= 0);
});

test('dashboard exposes themes, commands, and text viewer controls', async () => {
  const html = await (await request('/status')).text();
  assert.match(html, /View Themes/);
  assert.match(html, /View Commands/);
  assert.match(html, /View Text/);
  assert.match(html, /openCatalog\('themes'\)/);
  assert.match(html, /openCatalog\('commands'\)/);

  const response = await request('/api/catalog');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.activeTheme, 'Redragon');
  assert.equal(data.themes.length, 10);
  assert.ok(data.commandCount > 0);
  assert.ok(data.pluginCount > 0);
  assert.ok(data.groups.some(group => group.commands.includes('menu')) === false);
  assert.ok(data.groups.some(group => group.commands.includes('ping')));
});

test('pairing validates input with local storage', async () => {
  const send = number => request('/code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number })
  });
  assert.equal((await send('123')).status, 400);
  assert.equal((await send({ bad: 'type' })).status, 400);
  assert.equal((await request('/code?number=27634988678')).status, 404);
});

test('pairing and reconnect are public and use local storage without Supabase', async () => {
  const response = await request('/code/connect-all', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).attempted, 0);
  const pairResponse = await request('/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: '123' }) });
  assert.equal(pairResponse.status, 400);
  assert.equal((await request('/code/token', { method: 'POST' })).status, 404);
});
