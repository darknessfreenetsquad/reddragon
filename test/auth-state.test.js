'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { useFileAuthState, removeFileAuthState, useSupabaseAuthState } = require('../auth-state');

function storage() {
  let row = null;
  let blocker = null;
  let fail = false;
  return {
    client: { from() { return {
      select() { return { eq() { return { maybeSingle: async () => ({ data: row, error: null }) }; } }; },
      async upsert(value) {
        if (blocker) await blocker;
        if (fail) return { error: { message: 'write denied' } };
        row = JSON.parse(JSON.stringify(value));
        return { error: null };
      }
    }; } },
    block() { let release; blocker = new Promise(resolve => { release = resolve; }); return () => { blocker = null; release(); }; },
    clear() { row = null; },
    fail() { fail = true; },
    get row() { return row; }
  };
}

test('Signal keys survive reload, including binary values and deletion', async () => {
  const db = storage();
  const first = await useSupabaseAuthState(db.client, '12345678901');
  first.state.creds.registered = true;
  await first.saveCreds();
  await first.state.keys.set({ session: { a: { value: Buffer.from('binary') }, b: { value: Buffer.from('other') } } });
  await first.state.keys.set({ session: { b: null } });
  const second = await useSupabaseAuthState(db.client, '12345678901');
  assert.equal(second.state.creds.registered, true);
  const keys = await second.state.keys.get('session', ['a', 'b']);
  assert.deepEqual(keys.a.value, Buffer.from('binary'));
  assert.equal(keys.b, undefined);
});

test('stopping drains writes and prevents late events recreating deleted credentials', async () => {
  const db = storage();
  const state = await useSupabaseAuthState(db.client, '12345678901');
  const release = db.block();
  const write = state.saveCreds();
  await new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const stopping = state.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  release();
  await Promise.all([write, stopping]);
  db.clear();
  await state.saveCreds();
  await state.state.keys.set({ session: { stale: { value: 1 } } });
  assert.equal(db.row, null);
});

test('database write failures are surfaced to the caller', async () => {
  const db = storage();
  const state = await useSupabaseAuthState(db.client, '12345678901');
  db.fail();
  await assert.rejects(state.saveCreds(), /write denied/);
  await assert.rejects(state.flush(), /write denied/);
});

test('local auth state survives reload and removes credentials', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'red-mini-auth-'));
  try {
    const first = await useFileAuthState(directory, '27634988678');
    first.state.creds.registered = true;
    await first.state.keys.set({ session: { device: { value: Buffer.from('local-secret') } } });
    await first.saveCreds();
    const second = await useFileAuthState(directory, '27634988678');
    assert.equal(second.state.creds.registered, true);
    const keys = await second.state.keys.get('session', ['device']);
    assert.deepEqual(keys.device.value, Buffer.from('local-secret'));
    await removeFileAuthState(directory, '27634988678');
    const fresh = await useFileAuthState(directory, '27634988678');
    assert.equal(fresh.state.creds.registered, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
