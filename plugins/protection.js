
'use strict';

const fs = require('fs');
const path = require('path');
const { redDragon } = require('../lib/response-style');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'protection.json');
const store = new Map();

const MAX_STORED_MESSAGES = 500;
const MESSAGE_TTL = 24 * 60 * 60 * 1000;

let cachedConfig = null;
let cachedMtimeMs = -1;

function config() {
  try {
    const mtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
    if (cachedConfig && cachedMtimeMs === mtimeMs) return cachedConfig;

    cachedConfig = {
      antidelete: false,
      antilink: false,
      antilinkAction: 'delete',
      ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    };
    cachedMtimeMs = mtimeMs;
  } catch {
    cachedConfig ||= {
      antidelete: false,
      antilink: false,
      antilinkAction: 'delete'
    };
  }

  return cachedConfig;
}

function save(value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(value, null, 2));
  cachedConfig = value;

  try {
    cachedMtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    cachedMtimeMs = -1;
  }
}

function unwrap(message) {
  let content = message;

  for (let i = 0; i < 8; i++) {
    const nested =
      content?.ephemeralMessage?.message ||
      content?.viewOnceMessage?.message ||
      content?.viewOnceMessageV2?.message ||
      content?.viewOnceMessageV2Extension?.message ||
      content?.documentWithCaptionMessage?.message ||
      content?.editedMessage?.message;

    if (!nested) break;
    content = nested;
  }

  return content || {};
}

function textOf(msg) {
  const m = unwrap(msg?.message);

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

function ownerJid(socket) {
  const id = String(socket.user?.id || '').split(':')[0];
  if (!id) return null;
  return `${id.split('@')[0]}@s.whatsapp.net`;
}

function isLink(text) {
  return /https?:\/\/\S+|www\.\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/i.test(text);
}

function cleanupStore() {
  const now = Date.now();

  for (const [id, saved] of store) {
    if (now - saved.at > MESSAGE_TTL) store.delete(id);
  }

  while (store.size > MAX_STORED_MESSAGES) {
    store.delete(store.keys().next().value);
  }
}

async function run(ctx) {
  const {
    socket, from, msg, args, command, footer,
    isOwner, isGroupAdmin
  } = ctx;

  const current = config();

  if (command === 'antidelete') {
    if (!isOwner) {
      return socket.sendMessage(from, {
        text: redDragon('ANTIDELETE', ['Owner only.'], footer)
      }, { quoted: msg });
    }

    const action = String(args[0] || '').toLowerCase();

    if (!['on', 'off'].includes(action)) {
      return socket.sendMessage(from, {
        text: redDragon('ANTIDELETE', [
          `Status: ${current.antidelete ? 'ON' : 'OFF'}`,
          'Usage: .antidelete on|off'
        ], footer)
      }, { quoted: msg });
    }

    current.antidelete = action === 'on';
    save(current);

    return socket.sendMessage(from, {
      text: redDragon('ANTIDELETE', [
        `Anti-delete ${action === 'on' ? 'enabled' : 'disabled'}.`
      ], footer)
    }, { quoted: msg });
  }

  if (!isGroupAdmin && !isOwner) {
    return socket.sendMessage(from, {
      text: redDragon('ANTILINK', [
        'Only group admins or the owner can use this command.'
      ], footer)
    }, { quoted: msg });
  }

  const action = String(args[0] || '').toLowerCase();

  if (action === 'on' || action === 'off') {
    current.antilink = action === 'on';
  } else if (
    action === 'set' &&
    ['delete', 'warn'].includes(String(args[1] || '').toLowerCase())
  ) {
    current.antilinkAction = args[1].toLowerCase();
  } else {
    return socket.sendMessage(from, {
      text: redDragon('ANTILINK', [
        `Status: ${current.antilink ? 'ON' : 'OFF'}`,
        `Action: ${current.antilinkAction}`,
        'Usage: .antilink on|off',
        '.antilink set delete|warn'
      ], footer)
    }, { quoted: msg });
  }

  save(current);

  await socket.sendMessage(from, {
    text: redDragon('ANTILINK', [
      `Antilink ${action === 'set'
        ? `action set to ${current.antilinkAction}`
        : action === 'on' ? 'enabled' : 'disabled'}.`
    ], footer)
  }, { quoted: msg });
}

async function onMessage(socket, msg) {
  if (!msg?.key?.id || msg.key.remoteJid === 'status@broadcast') return;

  const current = config();

  if (current.antidelete && msg.message) {
    store.set(msg.key.id, {
      msg,
      from: msg.key.remoteJid,
      sender: msg.key.participant || msg.key.remoteJid,
      at: Date.now()
    });
    cleanupStore();
  }

  if (
    current.antilink &&
    msg.key.remoteJid?.endsWith('@g.us') &&
    !msg.key.fromMe &&
    isLink(textOf(msg))
  ) {
    try {
      await socket.sendMessage(msg.key.remoteJid, {
        delete: msg.key
      });
    } catch (error) {
      console.error('Antilink delete failed:', error.message);
    }

    if (current.antilinkAction === 'warn') {
      const participant = msg.key.participant;

      await socket.sendMessage(msg.key.remoteJid, {
        text: redDragon('ANTILINK', [
          `Links are not allowed: @${String(participant || '').split('@')[0]}`
        ], '© ʀᴇᴅ ᴅʀᴀɢᴏɴ ᴅғs'),
        mentions: participant ? [participant] : []
      });
    }
  }
}

function getRevokedKey(update) {
  return (
    update?.update?.message?.protocolMessage?.key ||
    update?.message?.protocolMessage?.key ||
    update?.messages?.[0]?.message?.protocolMessage?.key ||
    update?.key ||
    null
  );
}

async function onRevocation(socket, update) {
  if (!config().antidelete) return;

  const key = getRevokedKey(update);
  if (!key?.id) return;

  const saved = store.get(key.id);
  if (!saved) return;

  // Delete before sending to prevent duplicate notifications.
  store.delete(key.id);

  const target = ownerJid(socket);
  if (!target) return;

  const sender = String(saved.sender || '');
  const senderNumber = sender.split('@')[0].split(':')[0];

  await socket.sendMessage(target, {
    text: redDragon('ANTIDELETE', [
      `Deleted message from @${senderNumber}`,
      textOf(saved.msg) || 'A media or non-text message was deleted.',
      `Chat: ${saved.from}`
    ], '© ʀᴇᴅ ᴅʀᴀɢᴏɴ ᴅғs'),
    mentions: sender ? [sender] : []
  });
}

module.exports = {
  commands: ['antidelete', 'antilink'],
  run,
  onMessage,
  onRevocation
};
