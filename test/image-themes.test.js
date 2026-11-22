'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listImageThemes,
  getImageTheme,
  getActiveImageTheme,
  setActiveImageTheme,
  getImageUrl
} = require('../lib/image-themes');
const menu = require('../plugins/menu');
const core = require('../plugins/core');

const expected = ['Aura', 'Gojo', 'Goku', 'Itachi', 'Luffy', 'Me', 'Naruto', 'Redragon', 'Tesla', 'Zoro'];

test('all supplied image themes have menu, ping, and welcome URLs', () => {
  assert.deepEqual(listImageThemes(), expected);
  for (const name of expected) {
    const theme = getImageTheme(name);
    for (const kind of ['menu', 'ping', 'welcome']) {
      assert.match(theme[kind], /^https:\/\/files\.catbox\.moe\/.+\.jpg$/);
      assert.equal(getImageUrl(kind, name), theme[kind]);
    }
  }
});

test('image theme selection is case-insensitive and falls back to Redragon', () => {
  assert.equal(setActiveImageTheme('gOjO'), true);
  assert.equal(getActiveImageTheme().name, 'Gojo');
  assert.equal(setActiveImageTheme('missing'), false);
  assert.equal(getActiveImageTheme().name, 'Gojo');
  setActiveImageTheme('Redragon');
});

test('menu and ping send selected artwork with compact captions', async () => {
  const socket = { sent: [], async sendMessage(to, message) { this.sent.push({ to, message }); } };
  const msg = { key: { remoteJid: '12345678901@s.whatsapp.net', id: '1' } };
  setActiveImageTheme('Naruto');
  await menu.run({ socket, msg, from: msg.key.remoteJid, prefix: '.', footer: 'footer' });
  await core.run({ socket, msg, from: msg.key.remoteJid, command: 'ping', footer: 'footer' });
  await core.run({ socket, msg, from: msg.key.remoteJid, command: 'alive', footer: 'footer', botName: 'Red Mini', ownerNumber: '12345678901', getUptime: () => 65 });
  const menuMessage = socket.sent.find(item => item.message.buttons)?.message;
  const pingMessage = socket.sent.find(item => item.message.caption?.includes('PONG'))?.message;
  const aliveMessage = socket.sent.find(item => item.message.caption?.includes('BOT ONLINE'))?.message;
  assert.equal(menuMessage.image.url, getImageUrl('menu'));
  assert.equal(pingMessage.image.url, getImageUrl('ping'));
  assert.match(pingMessage.caption, /PONG/);
  assert.equal(aliveMessage.image.url, getImageUrl('welcome'));
  assert.match(aliveMessage.caption, /Image Theme: Naruto/);
  setActiveImageTheme('Redragon');
});
