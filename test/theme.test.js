'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const themePlugin = require('../plugins/image-theme');
const { listThemes, setActiveTheme, getActiveThemeName, fmt } = require('../lib/theme');

function context(isOwner, args = []) {
  return {
    socket: { sent: [], async sendMessage(to, message) { this.sent.push(message); } },
    from: '12345678901@s.whatsapp.net',
    msg: { key: { remoteJid: '12345678901@s.whatsapp.net' } },
    args,
    footer: '© Red Dragon DFS',
    isOwner
  };
}

after(() => setActiveTheme('Redragon'));

test('image themes are the only selectable theme system', () => {
  assert.deepEqual(listThemes(), []);
  assert.equal(setActiveTheme('Goku'), true);
  assert.match(fmt('hello'), /𝙍𝙀𝘿 𝙓𝙈𝘿/);
  assert.match(fmt('hello'), /IMAGE THEME: Goku/);
  assert.ok(!fmt('hello').includes('━━━━━━━━━━━━━━━━━━'));
});

test('image-theme commands are owner-only', async () => {
  const denied = context(false, ['Goku']);
  await themePlugin.run(denied);
  assert.match(denied.socket.sent[0].text, /Owner only/);

  const owner = context(true, ['Goku']);
  await themePlugin.run(owner);
  assert.equal(getActiveThemeName(), 'Goku');
  assert.match(owner.socket.sent[0].text, /IMAGE THEME UPDATED/);
});
