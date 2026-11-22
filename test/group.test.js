'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const group = require('../plugins/group');

function context(command, args = []) {
  const calls = [];
  const socket = {
    user: { id: '99999999999@s.whatsapp.net' },
    async sendMessage(to, message) { calls.push(['sendMessage', to, message]); },
    async groupParticipantsUpdate(...values) { calls.push(['participants', ...values]); },
    async groupSettingUpdate(...values) { calls.push(['setting', ...values]); },
    async groupUpdateDescription(...values) { calls.push(['description', ...values]); }
  };
  return {
    socket,
    calls,
    from: '123@g.us',
    msg: { key: { remoteJid: '123@g.us' }, message: { conversation: '' } },
    command,
    args,
    footer: 'footer',
    prefix: '.',
    isGroup: true,
    isOwner: false,
    isGroupAdmin: true,
    isBotAdmin: true,
    groupMetadata: { participants: [
      { id: '99999999999@s.whatsapp.net', admin: 'admin' },
      { id: '11111111111@s.whatsapp.net' },
      { id: '22222222222@s.whatsapp.net', admin: 'admin' }
    ] }
  };
}

test('kick removes a selected participant but protects admins and the bot', async () => {
  const ctx = context('kick', ['11111111111']);
  await group.run(ctx);
  const call = ctx.calls.find(item => item[0] === 'participants');
  assert.deepEqual(call.slice(1), ['123@g.us', ['11111111111@s.whatsapp.net'], 'remove']);
});

test('kickall removes only non-admin participants', async () => {
  const ctx = context('kickall');
  await group.run(ctx);
  const call = ctx.calls.find(item => item[0] === 'participants');
  assert.deepEqual(call.slice(1), ['123@g.us', ['11111111111@s.whatsapp.net'], 'remove']);
});

test('mute, open, and description commands call the Baileys group operations', async () => {
  const muted = context('mute'); await group.run(muted);
  assert.deepEqual(muted.calls.find(item => item[0] === 'setting').slice(1), ['123@g.us', 'announcement']);
  const opened = context('open'); await group.run(opened);
  assert.deepEqual(opened.calls.find(item => item[0] === 'setting').slice(1), ['123@g.us', 'not_announcement']);
  const described = context('adddescription', ['new', 'description']); await group.run(described);
  assert.deepEqual(described.calls.find(item => item[0] === 'description').slice(1), ['123@g.us', 'new description']);
});

test('non-admins cannot run moderation commands', async () => {
  const ctx = context('kick', ['11111111111']);
  ctx.isGroupAdmin = false;
  await group.run(ctx);
  assert.equal(ctx.calls.some(item => item[0] === 'participants'), false);
  assert.match(ctx.calls[0][2].text, /Only a group admin/);
});

test('owners can run moderation commands without group-admin status', async () => {
  const ctx = context('kick', ['11111111111']);
  ctx.isGroupAdmin = false;
  ctx.isOwner = true;
  await group.run(ctx);
  assert.deepEqual(ctx.calls.find(item => item[0] === 'participants').slice(1), [
    '123@g.us',
    ['11111111111@s.whatsapp.net'],
    'remove'
  ]);
});

test('owners are blocked when the bot is not a group admin', async () => {
  const ctx = context('kick', ['11111111111']);
  ctx.isGroupAdmin = false;
  ctx.isOwner = true;
  ctx.isBotAdmin = false;
  await group.run(ctx);
  assert.equal(ctx.calls.some(item => item[0] === 'participants'), false);
  assert.match(ctx.calls[0][2].text, /bot must be a group admin/);
});
