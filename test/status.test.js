'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const status = require('../plugins/status');

function context(args = [], isOwner = true) {
  let config = {};
  const sent = [];
  return {
    args,
    isOwner,
    footer: 'footer',
    from: '123@s.whatsapp.net',
    msg: { key: { remoteJid: '123@s.whatsapp.net' } },
    socket: { async sendMessage(to, message) { sent.push(message); } },
    sent,
    async getUserConfig() { return config; },
    async setUserConfig(next) { config = next; }
  };
}

test('statusview reports the requested defaults and toggles auto viewing', async () => {
  const ctx = context(['off']);
  await status.run(ctx);
  assert.equal(ctx.sent[0].text.includes('Auto view: OFF'), true);
  assert.deepEqual(ctx.sent[0].text.includes('❤️ 💗 🔥 🥰'), true);
});

test('statusview persists like settings and custom emoji list', async () => {
  const ctx = context(['like', 'off']);
  await status.run(ctx);
  assert.match(ctx.sent[0].text, /Auto like: OFF/);
  const emojis = context(['emojis', '❤️', '💗', '🔥', '🥰']);
  await status.run(emojis);
  assert.match(emojis.sent[0].text, /❤️ 💗 🔥 🥰/);
});

test('statusview is owner-only', async () => {
  const ctx = context([], false);
  await status.run(ctx);
  assert.match(ctx.sent[0].text, /Owner only/);
});
