'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const baileys = require('@whiskeysockets/baileys');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.OWNER_NUMBER = '27800000000';
const tables = { sessions: new Map(), numbers: new Map(), configs: new Map(), admins: new Map(), newsletters: new Map() };
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const client = {
  from(table) {
    const rows = tables[table];
    return {
      select() {
        const all = () => ({ data: Array.from(rows.values()).map(copy), error: null });
        return {
          eq(field, value) {
            const row = Array.from(rows.values()).find(item => item[field] === value);
            return { maybeSingle: async () => ({ data: copy(row) || null, error: null }), single: async () => ({ data: copy(row) || null, error: null }) };
          },
          limit: async () => all(),
          then(resolve, reject) { return Promise.resolve(all()).then(resolve, reject); }
        };
      },
      async upsert(row) { rows.set(row.number || row.jid, copy(row)); return { error: null }; },
      delete() { return { async eq(field, value) { for (const [key, row] of rows) if (row[field] === value) rows.delete(key); return { error: null }; } }; }
    };
  }
};
const sockets = [];
const fakeBaileys = {
  ...baileys,
  makeCacheableSignalKeyStore: keys => keys,
  default: options => {
    const socket = {
      ev: new EventEmitter(),
      ws: { isOpen: true },
      user: { id: '27800000000:1@s.whatsapp.net' },
      options,
      sent: [],
      async requestPairingCode(number, customCode) {
        assert.equal(number, '27800000000');
        assert.equal(customCode, null, 'must not use the fork’s fixed default pairing code');
        assert.ok(this.ev.listenerCount('creds.update') > 0);
        assert.ok(this.ev.listenerCount('connection.update') > 0);
        return 'ABC12345';
      },
      async sendMessage(jid, message) { this.sent.push({ jid, message }); },
      end() {}, async logout() {}
    };
    sockets.push(socket);
    if (!options.auth.creds.registered) queueMicrotask(() => socket.ev.emit('connection.update', { qr: 'ready' }));
    return socket;
  }
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@supabase/supabase-js') return { createClient: () => client };
  if (request === '@whiskeysockets/baileys') return fakeBaileys;
  return originalLoad.call(this, request, parent, isMain);
};
const app = require('../index');
const pair = require('../pair');
Module._load = originalLoad;
const server = app.listen(0);
after(() => server.close());
const request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
const postCode = () => request('/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: '+27 80 000 0000' }) });
async function until(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for mocked async event');
}

test('connection-close errors are classified as transient', () => {
  assert.equal(pair.isTransientConnectionError({ output: { statusCode: 428 }, message: 'Connection Closed' }), true);
  assert.equal(pair.isTransientConnectionError(new Error('permission denied')), false);
});

test('owner recognition uses Baileys alternate phone JIDs when WhatsApp sends a LID', () => {
  const key = {
    remoteJid: '1847362910@lid',
    remoteJidAlt: '27800000000@s.whatsapp.net'
  };
  assert.deepEqual(pair.getMessageIdentityNumbers(key, { user: { id: 'bot@s.whatsapp.net' } }), ['1847362910', '27800000000']);
  assert.equal(pair.isOwnerMessage(key, { user: { id: 'bot@s.whatsapp.net' } }, '12345678901'), true);
  assert.equal(pair.isOwnerMessage({ remoteJid: '1847362910@lid' }, { user: { id: 'bot@s.whatsapp.net' } }, '12345678901'), false);
});

test('pairing registers handlers, persists credentials and keys, tracks active sockets, and restores sessions', async () => {
  const [first, second] = await Promise.all([postCode(), postCode()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).code, 'ABC12345');
  assert.equal((await second.json()).code, 'ABC12345');
  assert.equal(sockets.length, 1, 'duplicate pairing requests must share one socket');
  assert.equal((await (await request('/api/status')).json()).activeSessions, 0);

  const socket = sockets[0];
  socket.ev.emit('messages.upsert', {
    messages: [{ key: { remoteJid: '27800000000@s.whatsapp.net', fromMe: true }, message: { conversation: '.menu' } }]
  });
  await until(() => socket.sent.some(item => item.message.buttons?.length === 5));
  const menuMessage = socket.sent.find(item => item.message.buttons?.length === 5).message;
  assert.match(menuMessage.caption || menuMessage.text, /𝙍𝙀𝘿 𝙓𝙈𝘿/);
  assert.equal(menuMessage.buttons[0].buttonId, '.alive');

  socket.ev.emit('messages.upsert', {
    messages: [
      { key: { remoteJid: '12345678901@s.whatsapp.net' }, message: { conversation: 'not a command' } },
      { key: { remoteJid: '12345678901@s.whatsapp.net' }, message: { ephemeralMessage: { message: { extendedTextMessage: { text: '.ping' } } } } }
    ]
  });
  await until(() => socket.sent.some(item => (item.message.text || item.message.caption)?.includes('PONG')));

  socket.options.auth.creds.registered = true;
  socket.ev.emit('creds.update');
  await socket.options.auth.keys.set({ session: { device1: { value: Buffer.from('secret-key') } } });
  await until(() => tables.sessions.has('27800000000'));
  socket.ev.emit('connection.update', { connection: 'open' });
  await until(() => tables.numbers.has('27800000000') && socket.sent.length > 0);
  await until(() => socket.sent.some(item => (item.message.caption || item.message.text || '').includes('RED MINI BOT CONNECTED')));
  const connectionMessage = socket.sent.find(item => (item.message.caption || item.message.text || '').includes('RED MINI BOT CONNECTED'));
  assert.equal(connectionMessage.jid, '27800000000@s.whatsapp.net');

  const status = await (await request('/api/status')).json();
  assert.equal(status.activeSessions, 1);
  assert.equal(status.database, 'connected');
  assert.deepEqual(status.sessions, ['*******0000']);
  assert.equal((await (await postCode()).json()).status, 'already_connected');
  assert.equal((await request('/code/connect-all', { method: 'POST' })).status, 200);

  const command = (body, from, fromMe = false) => socket.ev.emit('messages.upsert', {
    messages: [{ key: { remoteJid: from, fromMe }, message: { conversation: body } }]
  });
  command('.admin list', '12345678901@s.whatsapp.net');
  await until(() => socket.sent.some(item => item.message.text?.includes('Owner only')));
  const beforeWorkType = socket.sent.length;
  command('.wtype private', '27800000000@s.whatsapp.net', true);
  await until(() => tables.configs.get('27800000000')?.config.WORK_TYPE === 'private');
  await until(() => socket.sent.slice(beforeWorkType).some(item => item.message.react?.text === '✅'));
  await new Promise(resolve => setTimeout(resolve, 20));
  const sentBefore = socket.sent.length;
  command('.ping', '12345678901@s.whatsapp.net');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(socket.sent.length, sentBefore, 'private mode ignores other users');
  command('.not-a-real-command', '27800000000@s.whatsapp.net', true);
  await until(() => socket.sent.some(item => item.message.text?.includes('Unknown command')));

  socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: baileys.DisconnectReason.connectionLost } } } });
  assert.equal(pair.getActiveSessions().length, 0);
  const reconnect = await request('/code/connect-all', { method: 'POST' });
  assert.equal(reconnect.status, 200);
  assert.equal((await reconnect.json()).attempted, 1);
  assert.equal(sockets.length, 2);
  const restored = sockets[1];
  assert.equal(restored.options.auth.creds.registered, true);
  const restoredKeys = await restored.options.auth.keys.get('session', ['device1']);
  assert.deepEqual(restoredKeys.device1.value, Buffer.from('secret-key'));
  restored.ev.emit('connection.update', { connection: 'open' });
  await until(() => pair.getActiveSessions().length === 1);
  restored.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: baileys.DisconnectReason.loggedOut } } } });
  await until(() => !tables.sessions.has('27800000000') && !tables.numbers.has('27800000000'));
});
