'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const STORE_FILE = path.join(DATA_DIR, 'store.json');
let pending = Promise.resolve();

const emptyStore = () => ({ numbers: [], configs: {}, admins: [], newsletters: [] });

async function readStore() {
  try {
    const value = JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
    return {
      ...emptyStore(),
      ...value,
      numbers: Array.isArray(value.numbers) ? value.numbers : [],
      configs: value.configs && typeof value.configs === 'object' ? value.configs : {},
      admins: Array.isArray(value.admins) ? value.admins : [],
      newsletters: Array.isArray(value.newsletters) ? value.newsletters : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw new Error(`Unable to read local data store: ${error.message}`);
  }
}

async function writeStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, STORE_FILE);
}

function updateStore(mutator) {
  const operation = pending.catch(() => {}).then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  pending = operation;
  return operation;
}

async function snapshot() {
  await pending;
  return readStore();
}

module.exports = {
  DATA_DIR,
  async listNumbers() { return (await snapshot()).numbers.slice(); },
  addNumber(number) {
    return updateStore(store => {
      if (!store.numbers.includes(number)) store.numbers.push(number);
    });
  },
  removeNumber(number) {
    return updateStore(store => {
      store.numbers = store.numbers.filter(value => value !== number);
      delete store.configs[number];
    });
  },
  async getConfig(number) { return (await snapshot()).configs[number] || null; },
  setConfig(number, config) {
    return updateStore(store => { store.configs[number] = config || {}; });
  },
  async listAdmins() { return (await snapshot()).admins.slice(); },
  addAdmin(jid) {
    return updateStore(store => {
      if (!store.admins.includes(jid)) store.admins.push(jid);
    });
  },
  removeAdmin(jid) {
    return updateStore(store => { store.admins = store.admins.filter(value => value !== jid); });
  },
  addNewsletter(jid, emojis = []) {
    return updateStore(store => {
      const existing = store.newsletters.find(value => value.jid === jid);
      if (existing) existing.emojis = emojis;
      else store.newsletters.push({ jid, emojis });
    });
  },
  removeNewsletter(jid) {
    return updateStore(store => { store.newsletters = store.newsletters.filter(value => value.jid !== jid); });
  },
  async listNewsletters() { return (await snapshot()).newsletters.slice(); }
};
