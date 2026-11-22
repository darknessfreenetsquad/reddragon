'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');

async function useFileAuthState(baseDir, number) {
  const directory = path.join(path.resolve(baseDir), 'auth', number);
  const credsFile = path.join(directory, 'creds.json');
  const keysFile = path.join(directory, 'keys.json');
  const read = async (file, fallback) => {
    try { return JSON.parse(await fs.readFile(file, 'utf8'), BufferJSON.reviver); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  };
  const creds = await read(credsFile, initAuthCreds());
  const keys = await read(keysFile, {});
  let pendingWrite = Promise.resolve();
  let stopped = false;

  function persist() {
    if (stopped) return Promise.resolve();
    const credsSnapshot = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
    const keysSnapshot = JSON.parse(JSON.stringify(keys, BufferJSON.replacer));
    const write = async () => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const stamp = `${process.pid}.${Date.now()}`;
      const credsTemp = `${credsFile}.${stamp}.tmp`;
      const keysTemp = `${keysFile}.${stamp}.tmp`;
      try {
        await fs.writeFile(credsTemp, `${JSON.stringify(credsSnapshot)}\n`, { mode: 0o600 });
        await fs.writeFile(keysTemp, `${JSON.stringify(keysSnapshot)}\n`, { mode: 0o600 });
        await fs.rename(credsTemp, credsFile);
        await fs.rename(keysTemp, keysFile);
      } finally {
        await fs.rm(credsTemp, { force: true }).catch(() => {});
        await fs.rm(keysTemp, { force: true }).catch(() => {});
      }
    };
    const result = pendingWrite.catch(() => {}).then(write);
    pendingWrite = result;
    return result;
  }

  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const result = {};
          for (const id of ids) {
            let value = keys[type]?.[id];
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            result[id] = value;
          }
          return result;
        },
        async set(data) {
          for (const [type, items] of Object.entries(data)) {
            keys[type] ||= {};
            for (const [id, value] of Object.entries(items)) {
              if (value == null) delete keys[type][id];
              else keys[type][id] = value;
            }
          }
          await persist();
        }
      }
    },
    saveCreds: persist,
    flush: () => pendingWrite,
    async stop() {
      stopped = true;
      await pendingWrite.catch(() => {});
    }
  };
}

async function removeFileAuthState(baseDir, number) {
  await fs.rm(path.join(path.resolve(baseDir), 'auth', number), { recursive: true, force: true });
}

// Retained for existing Supabase deployments and backward-compatible tests.
async function useSupabaseAuthState(supabase, number) {
  const { data, error } = await supabase.from('sessions').select('creds, keys').eq('number', number).maybeSingle();
  if (error) throw new Error(`Unable to load session: ${error.message}`);
  const decode = value => value == null ? null : JSON.parse(JSON.stringify(value), BufferJSON.reviver);
  const creds = decode(data?.creds) || initAuthCreds();
  const keys = decode(data?.keys) || {};
  let pendingWrite = Promise.resolve();
  let stopped = false;
  function persist() {
    if (stopped) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer));
    const write = async () => {
      const { error: writeError } = await supabase.from('sessions').upsert({ number, ...snapshot, updated_at: new Date().toISOString() });
      if (writeError) throw new Error(`Unable to save session: ${writeError.message}`);
    };
    const result = pendingWrite.catch(() => {}).then(write);
    pendingWrite = result;
    return result;
  }
  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const result = {};
          for (const id of ids) {
            let value = keys[type]?.[id];
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            result[id] = value;
          }
          return result;
        },
        async set(data) {
          for (const [type, items] of Object.entries(data)) {
            keys[type] ||= {};
            for (const [id, value] of Object.entries(items)) {
              if (value == null) delete keys[type][id];
              else keys[type][id] = value;
            }
          }
          await persist();
        }
      }
    },
    saveCreds: persist,
    flush: () => pendingWrite,
    async stop() { stopped = true; await pendingWrite.catch(() => {}); }
  };
}

module.exports = { useFileAuthState, removeFileAuthState, useSupabaseAuthState };
