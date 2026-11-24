const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const runFile = promisify(execFile);
const { loadPlugins } = require('./plugin-loader');
const commandPlugins = loadPlugins();
const protectionPlugin = require('./plugins/protection');
const { fmt, isThemedText } = require('./lib/theme');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const axios = require('axios');
const cheerio = require('cheerio');
const EXTERNAL_REQUEST_TIMEOUT = 15000;
const { createClient } = require('@supabase/supabase-js');
const { useFileAuthState, removeFileAuthState, useSupabaseAuthState } = require('./auth-state');
const localStore = require('./local-store');
const defaultConfig = require('./config');
const { getImageUrl } = require('./lib/image-themes');
const { toSticker: convertToSticker } = require('./lib/sticker');

const {
  default: makeWASocket,
  Browsers,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  downloadContentFromMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys');

// ========== CONFIGURATION ==========
const BOT_NAME = process.env.BOT_NAME || 'Red Mini';
const configuredOwner = process.env.OWNER_NUMBER || '';
const OWNER_NUMBER = /^\d{10,15}$/.test(configuredOwner) ? configuredOwner : null;
const OWNER_NAME = process.env.OWNER_NAME || 'Red Dragon';
const NEWSLETTER_JID = process.env.NEWSLETTER_JID || '120363427119111004@newsletter';
const FOOTER = '© ʀᴇᴅ ᴅʀᴀɢᴏɴ ᴅғs';
const BOT_IMAGE = 'https://files.catbox.moe/eumprt.jpg';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'false',
  AUTO_LIKE_EMOJI: ['❤️', '💗', '🔥', '🥰'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  OTP_EXPIRY: 300000,
  BOT_NAME: BOT_NAME,
  OWNER_NAME,
  OWNER_NUMBER: OWNER_NUMBER,
  BOT_VERSION: '1.0.0',
  BOT_FOOTER: FOOTER,
  RCD_IMAGE_PATH: BOT_IMAGE
};

// ========== STORAGE SETUP ==========
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const storageMode = supabase ? 'supabase' : 'local';
const userConfigCache = new Map();
const USER_CONFIG_CACHE_TTL = 30 * 1000;

console.log(`Storage backend: ${storageMode}${supabase ? '' : ` (${localStore.DATA_DIR})`}`);

// ========== STORAGE HELPERS ==========
async function removeSessionFromSupabase(number) {
  if (!supabase) {
    await localStore.removeNumber(number);
    return removeFileAuthState(localStore.DATA_DIR, number);
  }
  const sanitized = number.replace(/[^0-9]/g, '');
  for (const table of ['numbers', 'sessions', 'configs']) {
    const { error } = await supabase.from(table).delete().eq('number', sanitized);
    if (error) throw new Error(`Unable to delete ${table}: ${error.message}`);
  }
}

async function addNumberToSupabase(number) {
  if (!supabase) return localStore.addNumber(number);
  const sanitized = number.replace(/[^0-9]/g, '');
  const { error } = await supabase.from('numbers').upsert({ number: sanitized });
  if (error) throw new Error(`Unable to save number: ${error.message}`);
}

async function getAllNumbersFromSupabase() {
  if (!supabase) return localStore.listNumbers();
  const { data, error } = await supabase.from('numbers').select('number');
  if (error) throw new Error(`Unable to load sessions: ${error.message}`);
  return data ? data.map(d => d.number) : [];
}

async function checked(query, context) {
  const result = await query;
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}
async function loadUserConfigFromSupabase(number) {
  const key = String(number || '');
  const cached = userConfigCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value;
  if (!supabase) value = await localStore.getConfig(number);
  else {
    const data = await checked(supabase.from('configs').select('config').eq('number', number).maybeSingle(), 'Unable to load config');
    value = data?.config || null;
  }
  userConfigCache.set(key, { value, expiresAt: Date.now() + USER_CONFIG_CACHE_TTL });
  return value;
}
async function setUserConfigInSupabase(number, configObj) {
  if (!supabase) await localStore.setConfig(number, configObj);
  else await checked(supabase.from('configs').upsert({ number, config: configObj, updated_at: new Date().toISOString() }), 'Unable to save config');
  userConfigCache.set(String(number || ''), { value: configObj, expiresAt: Date.now() + USER_CONFIG_CACHE_TTL });
}
async function loadAdminsFromSupabase() {
  if (!supabase) return localStore.listAdmins();
  const data = await checked(supabase.from('admins').select('jid'), 'Unable to load admins');
  return (data || []).map(d => d.jid);
}
async function addAdminToSupabase(jid) {
  if (!supabase) return localStore.addAdmin(jid);
  await checked(supabase.from('admins').upsert({ jid }), 'Unable to add admin');
}
async function removeAdminFromSupabase(jid) {
  if (!supabase) return localStore.removeAdmin(jid);
  await checked(supabase.from('admins').delete().eq('jid', jid), 'Unable to remove admin');
}
async function addNewsletterToSupabase(jid, emojis = []) {
  if (!supabase) return localStore.addNewsletter(jid, emojis);
  await checked(supabase.from('newsletters').upsert({ jid, emojis, added_at: new Date().toISOString() }), 'Unable to add newsletter');
}
async function removeNewsletterFromSupabase(jid) {
  if (!supabase) return localStore.removeNewsletter(jid);
  await checked(supabase.from('newsletters').delete().eq('jid', jid), 'Unable to remove newsletter');
}
async function listNewslettersFromSupabase() {
  if (!supabase) return localStore.listNewsletters();
  const data = await checked(supabase.from('newsletters').select('*'), 'Unable to load newsletters');
  return (data || []).map(d => ({ jid: d.jid, emojis: d.emojis || [] }));
}
// ========== UTILS ==========
function getSouthAfricaTimestamp() {
  return moment().tz('Africa/Johannesburg').format('YYYY-MM-DD HH:mm:ss');
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isTransientConnectionError(error) {
  const statusCode = error?.output?.statusCode || error?.data?.statusCode;
  const message = String(error?.message || error || '').toLowerCase();
  return statusCode === 428 || message.includes('connection closed') || message.includes('connection is closed');
}

function guardSocketSender(socket, number) {
  const sendMessage = socket.sendMessage.bind(socket);
  socket.sendMessage = async (...args) => {
    try {
      const [jid, rawMessage, options] = args;
      const message = rawMessage && typeof rawMessage === 'object' ? { ...rawMessage } : rawMessage;
      if (message && typeof message.text === 'string' && !isThemedText(message.text)) message.text = fmt(message.text);
      if (message && typeof message.caption === 'string' && !isThemedText(message.caption)) message.caption = fmt(message.caption);
      return await sendMessage(jid, message, options);
    } catch (error) {
      if (isTransientConnectionError(error)) {
        console.warn(`Skipped message for ${number}: WhatsApp connection is closing`);
        return null;
      }
      throw error;
    }
  };
}

async function sendWithTimeout(socket, jid, message, options, timeoutMs = 8000) {
  let timer;
  try {
    return await Promise.race([
      socket.sendMessage(jid, message, options),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Message send timed out')), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function safeCommandReaction(socket, jid, key, text) {
  try {
    await socket.sendMessage(jid, { react: { text, key } });
  } catch (error) {
    // Reactions are optional UI feedback and must never bring down command handling.
    console.warn(`Could not send command reaction ${text}:`, error.message);
  }
}

async function downloadQuotedMedia(quoted) {
  if (!quoted) return null;
  const qTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
  const qType = qTypes.find(t => quoted[t]);
  if (!qType) return null;
  const messageType = qType.replace(/Message$/i, '').toLowerCase();
  const stream = await downloadContentFromMessage(quoted[qType], messageType);
  // Capture Undici/Baileys socket failures before consuming the readable.
  if (stream && typeof stream.on === 'function') stream.on('error', () => {});
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) throw new Error('Media exceeds 20 MB limit');
      chunks.push(chunk);
    }
  } catch (error) {
    throw new Error(`Media download failed: ${error.message || error}`);
  }
  const buffer = Buffer.concat(chunks);
  return {
    buffer,
    mime: quoted[qType].mimetype || '',
    caption: quoted[qType].caption || quoted[qType].fileName || '',
    ptt: quoted[qType].ptt || false,
    fileName: quoted[qType].fileName || ''
  };
}

// ========== ACTIVE SESSIONS ==========
const activeSockets = new Map();
const connectingSockets = new Map();
const inFlight = new Map();
const closingSessions = new Map();
const stoppedSessions = new Set();
const revokingSessions = new Set();
const authStores = new WeakMap();
const socketCreationTime = new Map();
const otpStore = new Map();

// ========== COMMAND HANDLER ==========
function unwrapMessageContent(message) {
  let content = message;
  for (let i = 0; i < 5; i++) {
    const nested = content?.ephemeralMessage?.message ||
      content?.viewOnceMessage?.message ||
      content?.viewOnceMessageV2?.message ||
      content?.documentWithCaptionMessage?.message ||
      content?.editedMessage?.message;
    if (!nested) break;
    content = nested;
  }
  return content;
}

function phoneNumberFromJid(jid) {
  if (typeof jid !== 'string') return null;
  const value = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return /^\d{10,15}$/.test(value) ? value : null;
}

function getMessageIdentityNumbers(key, socket) {
  const candidates = new Set();
  const add = value => {
    const number = phoneNumberFromJid(value);
    if (number) candidates.add(number);
  };
  if (key?.fromMe) add(socket?.user?.id);
  add(key?.participant);
  add(key?.remoteJid);
  // WhatsApp LID messages can expose the phone JID in one of these alternate fields.
  for (const field of ['participantAlt', 'remoteJidAlt', 'senderPn', 'participantPn', 'senderAlt']) add(key?.[field]);
  return [...candidates];
}

function isOwnerMessage(key, socket, sessionNumber) {
  if (key?.fromMe) return true;
  const identities = getMessageIdentityNumbers(key, socket);
  return identities.includes(sessionNumber) || Boolean(OWNER_NUMBER && identities.includes(OWNER_NUMBER));
}

function setupCommandHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages || []) {
    await protectionPlugin.onMessage(socket, msg).catch(error => console.error('Protection message hook error:', error.message));
    if (!msg?.key?.remoteJid || !msg.message || msg.key.remoteJid === 'status@broadcast') continue;

    const content = unwrapMessageContent(msg.message);
    const type = getContentType(content);
    let body = '';

    if (type === 'conversation') body = content.conversation || '';
    else if (type === 'extendedTextMessage') body = content.extendedTextMessage?.text || '';
    else if (type === 'imageMessage') body = content.imageMessage?.caption || '';
    else if (type === 'videoMessage') body = content.videoMessage?.caption || '';
    else if (type === 'buttonsResponseMessage') body = content.buttonsResponseMessage?.selectedButtonId || '';
    else if (type === 'listResponseMessage') body = content.listResponseMessage?.singleSelectReply?.selectedRowId || '';

    if (!body || typeof body !== 'string') continue;

    const from = msg.key.remoteJid;
    const botId = socket.user?.id;
    const sender = msg.key.fromMe
      ? (botId ? botId.split(':')[0] + '@s.whatsapp.net' : from)
      : (msg.key.participant || from);
    const identityNumbers = getMessageIdentityNumbers(msg.key, socket);
    const senderNumber = identityNumbers[0] || phoneNumberFromJid(sender) || sender.split('@')[0].split(':')[0];
    const isGroup = from.endsWith('@g.us');
    const prefix = config.PREFIX;
    const isCmd = body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
    const args = body.trim().split(/ +/).slice(1);

    if (!command) continue;
    console.log(`Command received: ${prefix}${command} from ${senderNumber} (${type})`);
    let commandError = null;
    let commandStarted = false;

    try {
      const userConfig = await loadUserConfigFromSupabase(sessionNumber) || {};
      const mode = userConfig.WORK_TYPE || 'public';
      const isOwner = isOwnerMessage(msg.key, socket, sessionNumber);
      if (!isOwner && (mode === 'private' || (mode === 'groups' && !isGroup) || (mode === 'inbox' && isGroup))) return;
      commandStarted = true;
      safeCommandReaction(socket, from, msg.key, '⏳').catch(() => {});
      let groupMetadata = null;
      let isGroupAdmin = isOwner;
      let isBotAdmin = false;
      if (isGroup) {
        try {
          groupMetadata = await socket.groupMetadata(from);
          const numberOf = value => phoneNumberFromJid(value);
          const senderParticipant = groupMetadata.participants?.find(participant =>
            participant.id === sender || participant.jid === sender || numberOf(participant.id) === senderNumber
          );
          const botNumber = phoneNumberFromJid(socket.user?.id);
          const botParticipant = groupMetadata.participants?.find(participant =>
            participant.id === socket.user?.id || participant.jid === socket.user?.id || numberOf(participant.id) === botNumber
          );
          isGroupAdmin = isOwner || ['admin', 'superadmin'].includes(senderParticipant?.admin);
          isBotAdmin = ['admin', 'superadmin'].includes(botParticipant?.admin);
        } catch (error) {
          console.error('group metadata lookup failed:', error.message);
        }
      }
      const plugin = commandPlugins.get(command);
      if (plugin) {
        await plugin.run({
          socket,
          msg,
          from,
          command,
          args,
          sender,
          senderNumber,
          sessionNumber,
          isOwner,
          isGroup,
          isGroupAdmin,
          isBotAdmin,
          groupMetadata,
          prefix,
          footer: FOOTER,
          ownerNumber: OWNER_NUMBER,
          ownerName: OWNER_NAME,
          botName: BOT_NAME,
          getUptime: () => Math.floor((Date.now() - (socketCreationTime.get(sessionNumber) || Date.now())) / 1000),
          getUserConfig: () => loadUserConfigFromSupabase(sessionNumber),
          setUserConfig: value => setUserConfigInSupabase(sessionNumber, value)
        });
        return;
      }
      // ==================== MENU COMMAND WITH BUTTONS ====================
      if (command === 'menu') {
        await socket.sendMessage(from, { react: { text: '🔴', key: msg.key } });

        const uptime = Math.floor((Date.now() - (socketCreationTime.get(sessionNumber) || Date.now())) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const menuText = `╭───❰ 🔴 RED MINI BOT 🔴 ❱───╮
│
│ 🤖 *Name:* Red Mini
│ 👑 *Owner:* ${OWNER_NAME}
│ ⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 📡 *Status:* Active
│ 🇿🇦 *Region:* South Africa
│
╰─────────────────────╯

╭───❰ 📥 DOWNLOADER ❱───╮
│ 🎧 ${prefix}play <song or artist>
│ 🎵 ${prefix}music <song or artist>
│ 📘 ${prefix}fb <url>
│ 🎨 ${prefix}sticker
│ 📸 ${prefix}instagram <url>
│ 🐦 ${prefix}twitter <url>
│ 📹 ${prefix}tiktok <url>
╰─────────────────────╯

╭───❰ 🛠️ TOOLS ❱───╮
│ 🌤️ ${prefix}weather <city>
│ 🔍 ${prefix}google <query>
│ 📝 ${prefix}translate <text>
│ 🔗 ${prefix}short <url>
│ 🧮 ${prefix}calc <math>
│ 🆔 ${prefix}jid
│ 💾 ${prefix}save
│ 🔐 ${prefix}pair <number>
╰─────────────────────╯

╭───❰ ⚙️ SETTINGS ❱───╮
│ 🤖 ${prefix}alive
│ ⚡ ${prefix}ping
│ 🎭 ${prefix}profile
│ 📊 ${prefix}stats
│ 🔧 ${prefix}setting
╰─────────────────────╯

╭───❰ 👑 OWNER ❱───╮
│ 📢 ${prefix}broadcast
│ 👥 ${prefix}admin
│ 📰 ${prefix}newsletter
│ 🗑️ ${prefix}deleteme
╰─────────────────────╯

${FOOTER}`;

        const buttons = [
          { buttonId: `${prefix}alive`, buttonText: { displayText: '🤖 ALIVE' }, type: 1 },
          { buttonId: `${prefix}ping`, buttonText: { displayText: '⚡ PING' }, type: 1 },
          { buttonId: `${prefix}sticker`, buttonText: { displayText: '🎨 STICKER' }, type: 1 },
          { buttonId: `${prefix}music`, buttonText: { displayText: '🎵 MUSIC' }, type: 1 },
          { buttonId: `${prefix}weather`, buttonText: { displayText: '🌤️ WEATHER' }, type: 1 }
        ];

        try {
          await socket.sendMessage(from, {
            text: menuText,
            footer: FOOTER,
            buttons
          }, { quoted: msg });
        } catch (buttonError) {
          console.error('Menu buttons failed; sending text fallback:', buttonError.message);
          await socket.sendMessage(from, { text: menuText }, { quoted: msg });
        }
        return;
      }

      // ==================== ALIVE COMMAND ====================
      if (command === 'alive') {
        const uptime = Math.floor((Date.now() - (socketCreationTime.get(sessionNumber) || Date.now())) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const aliveText = `🔴 *RED MINI IS ONLINE* 🔴
━━━━━━━━━━━━━━━━━━
🤖 *Bot:* Red Mini
👑 *Owner:* ${OWNER_NAME}
⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s
📡 *Status:* Active
🇿🇦 *Region:* South Africa
━━━━━━━━━━━━━━━━━━
${FOOTER}`;

        await socket.sendMessage(from, {
          image: { url: BOT_IMAGE },
          caption: aliveText
        }, { quoted: msg });
        return;
      }

      // ==================== PING COMMAND ====================
      if (command === 'ping') {
        const start = Date.now();
        await socket.sendMessage(from, { react: { text: '⏳', key: msg.key } });
        const latency = Date.now() - start;
        const pingText = `⚡ *PONG!*\n━━━━━━━━━━━━━━━━━━\n📡 *Latency:* ${latency}ms\n🚀 *Speed:* ${latency < 100 ? 'Excellent' : latency < 300 ? 'Good' : 'Slow'}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`;
        await socket.sendMessage(from, { text: pingText }, { quoted: msg });
        return;
      }

      // ==================== STICKER COMMAND ====================
      if (command === 'sticker' || command === 's') {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const mime = msg.message?.imageMessage?.mimetype ||
          quoted?.imageMessage?.mimetype ||
          msg.message?.videoMessage?.mimetype ||
          quoted?.videoMessage?.mimetype;

        if (!mime) {
          await socket.sendMessage(from, { text: '❌ Reply to an image or video!' }, { quoted: msg });
          return;
        }

        try {
          const mediaMessage = (msg.message?.imageMessage || msg.message?.videoMessage) ? msg.message : quoted;
          const media = await downloadQuotedMedia(mediaMessage);
          if (!media?.buffer) throw new Error('Missing media');
          await socket.sendMessage(from, { sticker: await convertToSticker(media.buffer, mime) }, { quoted: msg });
        } catch (e) {
          await socket.sendMessage(from, { text: `❌ Error creating sticker: ${e.message}` }, { quoted: msg });
        }
        return;
      }

      // ==================== FACEBOOK DOWNLOADER ====================
      if (command === 'fb' || command === 'facebook') {
        const url = args[0];
        if (!url) {
          await socket.sendMessage(from, { text: '📘 *Usage:* .fb <facebook video url>' }, { quoted: msg });
          return;
        }

        await socket.sendMessage(from, { react: { text: '📘', key: msg.key } });

        try {
          const apiUrl = `https://api.siputzx.my.id/api/download/fb?url=${encodeURIComponent(url)}`;
          const { data } = await axios.get(apiUrl, { timeout: EXTERNAL_REQUEST_TIMEOUT });

          if (!data.result?.hd) {
            await socket.sendMessage(from, { text: '❌ Failed to fetch video' }, { quoted: msg });
            return;
          }

          await socket.sendMessage(from, {
            video: { url: data.result.hd },
            caption: `📘 *Facebook Video*\n\n${FOOTER}`
          }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
        }
        return;
      }

      // ==================== INSTAGRAM DOWNLOADER ====================
      if (command === 'instagram' || command === 'ig') {
        const url = args[0];
        if (!url) {
          await socket.sendMessage(from, { text: '📸 *Usage:* .ig <instagram url>' }, { quoted: msg });
          return;
        }

        await socket.sendMessage(from, { react: { text: '📸', key: msg.key } });

        try {
          const apiUrl = `https://api.siputzx.my.id/api/download/ig?url=${encodeURIComponent(url)}`;
          const { data } = await axios.get(apiUrl, { timeout: EXTERNAL_REQUEST_TIMEOUT });

          if (!data.result?.url) {
            await socket.sendMessage(from, { text: '❌ Failed to fetch media' }, { quoted: msg });
            return;
          }

          if (data.result.url.endsWith('.mp4')) {
            await socket.sendMessage(from, { video: { url: data.result.url }, caption: `📸 *Instagram Video*\n\n${FOOTER}` }, { quoted: msg });
          } else {
            await socket.sendMessage(from, { image: { url: data.result.url }, caption: `📸 *Instagram Image*\n\n${FOOTER}` }, { quoted: msg });
          }

        } catch (err) {
          await socket.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
        }
        return;
      }

      // ==================== TIKTOK DOWNLOADER ====================
      if (command === 'tiktok' || command === 'tt') {
        const url = args[0];
        if (!url) {
          await socket.sendMessage(from, { text: '📹 *Usage:* .tt <tiktok url>' }, { quoted: msg });
          return;
        }

        await socket.sendMessage(from, { react: { text: '📹', key: msg.key } });

        try {
          const apiUrl = `https://api.siputzx.my.id/api/download/tiktok?url=${encodeURIComponent(url)}`;
          const { data } = await axios.get(apiUrl, { timeout: EXTERNAL_REQUEST_TIMEOUT });

          if (!data.result?.video) {
            await socket.sendMessage(from, { text: '❌ Failed to fetch video' }, { quoted: msg });
            return;
          }

          await socket.sendMessage(from, {
            video: { url: data.result.video },
            caption: `📹 *TikTok Video*\n👤 Author: ${data.result.author || 'Unknown'}\n\n${FOOTER}`
          }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
        }
        return;
      }

      // ==================== TWITTER DOWNLOADER ====================
      if (command === 'twitter' || command === 'tw') {
        const url = args[0];
        if (!url) {
          await socket.sendMessage(from, { text: '🐦 *Usage:* .tw <twitter url>' }, { quoted: msg });
          return;
        }

        await socket.sendMessage(from, { react: { text: '🐦', key: msg.key } });

        try {
          const apiUrl = `https://api.siputzx.my.id/api/download/twitter?url=${encodeURIComponent(url)}`;
          const { data } = await axios.get(apiUrl, { timeout: EXTERNAL_REQUEST_TIMEOUT });

          if (!data.result?.hd) {
            await socket.sendMessage(from, { text: '❌ Failed to fetch video' }, { quoted: msg });
            return;
          }

          await socket.sendMessage(from, {
            video: { url: data.result.hd },
            caption: `🐦 *Twitter Video*\n\n${FOOTER}`
          }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
        }
        return;
      }

      // ==================== WEATHER COMMAND ====================
      if (command === 'weather') {
        const city = args.join(' ');
        if (!city) {
          await socket.sendMessage(from, { text: '🌤️ *Usage:* .weather <city name>' }, { quoted: msg });
          return;
        }

        try {
          const apiKey = process.env.OPENWEATHER_API_KEY;
          if (!apiKey) {
            await socket.sendMessage(from, { text: '❌ Weather is not configured' }, { quoted: msg });
            return;
          }
          const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
          const { data } = await axios.get(url, { timeout: EXTERNAL_REQUEST_TIMEOUT });

          const weatherText = `🌤️ *Weather in ${data.name}, ${data.sys.country}*
━━━━━━━━━━━━━━━━━━
🌡️ *Temperature:* ${data.main.temp}°C
💧 *Humidity:* ${data.main.humidity}%
🌬️ *Wind:* ${data.wind.speed} m/s
☁️ *Condition:* ${data.weather[0].description}
━━━━━━━━━━━━━━━━━━
${FOOTER}`;

          await socket.sendMessage(from, { text: weatherText }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: '❌ City not found!' }, { quoted: msg });
        }
        return;
      }

      // ==================== TRANSLATE COMMAND ====================
      if (command === 'translate' || command === 'tr') {
        const lang = args[0] || 'af';
        const text = args.slice(1).join(' ') || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation;

        if (!text) {
          await socket.sendMessage(from, { text: '📝 *Usage:* .translate af Hello' }, { quoted: msg });
          return;
        }

        try {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
          const { data } = await axios.get(url, { timeout: EXTERNAL_REQUEST_TIMEOUT });
          const translated = data[0].map(part => part[0] || '').join('');

          await socket.sendMessage(from, {
            text: `📝 *Translation (${lang.toUpperCase()})*\n━━━━━━━━━━━━━━━━━━\n📌 Original: ${text}\n🔄 Translated: ${translated}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`
          }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: '❌ Translation failed' }, { quoted: msg });
        }
        return;
      }

      // ==================== CALCULATE COMMAND ====================
      if (command === 'calc') {
        const expr = args.join(' ');
        if (!expr) {
          await socket.sendMessage(from, { text: '🧮 *Usage:* .calc 2+2*5' }, { quoted: msg });
          return;
        }

        try {
          if (!/^[0-9+\-*/%().\s]+$/.test(expr)) throw new Error('Unsupported expression');
          const result = Function(`"use strict"; return (${expr})`)();
          if (!Number.isFinite(result)) throw new Error('Invalid result');
          await socket.sendMessage(from, {
            text: `🧮 *Calculator*\n━━━━━━━━━━━━━━━━━━\n📌 Question: ${expr}\n✅ Answer: ${result}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`
          }, { quoted: msg });
        } catch (err) {
          await socket.sendMessage(from, { text: '❌ Invalid expression' }, { quoted: msg });
        }
        return;
      }

      // ==================== SHORTEN URL ====================
      if (command === 'short') {
        const link = args[0];
        if (!link) {
          await socket.sendMessage(from, { text: '🔗 *Usage:* .short <url>' }, { quoted: msg });
          return;
        }

        try {
          const { data } = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}`, { timeout: EXTERNAL_REQUEST_TIMEOUT });
          await socket.sendMessage(from, {
            text: `🔗 *URL Shortened*\n━━━━━━━━━━━━━━━━━━\n🔗 Original: ${link}\n📎 Shortened: ${data}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`
          }, { quoted: msg });
        } catch (err) {
          await socket.sendMessage(from, { text: '❌ Failed to shorten URL' }, { quoted: msg });
        }
        return;
      }

      // ==================== GITHUB PROFILE ====================
      if (command === 'github' || command === 'git') {
        const user = args[0];
        if (!user) {
          await socket.sendMessage(from, { text: '🐙 *Usage:* .github <username>' }, { quoted: msg });
          return;
        }

        try {
          const { data } = await axios.get(`https://api.github.com/users/${user}`, { timeout: EXTERNAL_REQUEST_TIMEOUT });
          const profileText = `🐙 *GitHub Profile*\n━━━━━━━━━━━━━━━━━━\n👤 Name: ${data.name || 'N/A'}\n🔖 Username: ${data.login}\n📦 Repos: ${data.public_repos}\n👥 Followers: ${data.followers}\n🔗 URL: ${data.html_url}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`;

          await socket.sendMessage(from, {
            image: { url: data.avatar_url },
            caption: profileText
          }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: '❌ User not found' }, { quoted: msg });
        }
        return;
      }

      // ==================== JID COMMAND ====================
      if (command === 'jid') {
        await socket.sendMessage(from, {
          text: `🆔 *Your JID Info*\n━━━━━━━━━━━━━━━━━━\n📱 JID: ${sender}\n🔢 Number: +${senderNumber}\n📡 Type: ${isGroup ? 'Group' : 'Private Chat'}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`
        }, { quoted: msg });
        return;
      }

      // ==================== SAVE STATUS ====================
      if (command === 'save') {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
          await socket.sendMessage(from, { text: '💾 *Reply to a status message to save it*' }, { quoted: msg });
          return;
        }

        try {
          const text = quoted.conversation || quoted.extendedTextMessage?.text;
          if (text) {
            await socket.sendMessage(from, { text: `✅ *Saved Status*\n\n${text}` }, { quoted: msg });
            return;
          }
          const media = await downloadQuotedMedia(quoted);
          if (!media || !media.buffer) {
            await socket.sendMessage(from, { text: '❌ Failed to download media' }, { quoted: msg });
            return;
          }

          if (quoted.imageMessage) {
            await socket.sendMessage(from, { image: media.buffer, caption: '✅ Status Saved' });
          } else if (quoted.videoMessage) {
            await socket.sendMessage(from, { video: media.buffer, caption: '✅ Status Saved' });
          } else if (quoted.audioMessage) {
            await socket.sendMessage(from, { audio: media.buffer, ptt: true });
          } else if (quoted.conversation) {
            await socket.sendMessage(from, { text: `✅ *Saved Status*\n\n${quoted.conversation}` });
          }

          await socket.sendMessage(from, { text: '✅ Status saved successfully!' }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: '❌ Failed to save status' }, { quoted: msg });
        }
        return;
      }

      // ==================== PAIR COMMAND ====================
      if (command === 'pair') {
        if (isGroup) {
          await socket.sendMessage(from, { text: '❌ Request pairing codes in a private chat only.' }, { quoted: msg });
          return;
        }
        const number = args[0];
        if (!number) {
          await socket.sendMessage(from, { text: '🔐 *Usage:* .pair <number>' }, { quoted: msg });
          return;
        }

        try {
          const cleanNumber = number.replace(/[^0-9]/g, '');
          if (!isOwner) throw new Error('Permission denied');
          const result = await EmpirePair(cleanNumber, true);
          const code = result.code;
          if (!code) throw new Error('Pairing code unavailable');

          await socket.sendMessage(from, {
            text: `🔐 *Pairing Code*\n━━━━━━━━━━━━━━━━━━\n📱 Number: +${cleanNumber}\n🔑 Code: ${code}\n⏱️ Expires in 5 minutes\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`
          }, { quoted: msg });

        } catch (err) {
          await socket.sendMessage(from, { text: '❌ Failed to generate pairing code' }, { quoted: msg });
        }
        return;
      }

      // ==================== PROFILE COMMAND ====================
      if (command === 'profile') {
        const profileText = `👤 *Red Mini Bot Profile*
━━━━━━━━━━━━━━━━━━
🤖 *Name:* Red Mini
👑 *Owner:* ${OWNER_NAME}
📢 *Newsletter:* ${NEWSLETTER_JID}
🔢 *Prefix:* ${prefix}
🇿🇦 *Region:* South Africa
📡 *Status:* Active
━━━━━━━━━━━━━━━━━━
${FOOTER}`;

        await socket.sendMessage(from, {
          image: { url: BOT_IMAGE },
          caption: profileText
        }, { quoted: msg });
        return;
      }

      // ==================== STATS COMMAND ====================
      if (command === 'stats') {
        const totalSessions = activeSockets.size;
        const uptime = Math.floor((Date.now() - (socketCreationTime.get(sessionNumber) || Date.now())) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);

        const statsText = `📊 *Bot Statistics*
━━━━━━━━━━━━━━━━━━
🤖 *Bot Name:* Red Mini
⏱️ *Uptime:* ${hours}h ${minutes}m
📱 *Active Sessions:* ${totalSessions}
📡 *Status:* Online
🇿🇦 *Region:* South Africa
━━━━━━━━━━━━━━━━━━
${FOOTER}`;

        await socket.sendMessage(from, { text: statsText }, { quoted: msg });
        return;
      }

      // ==================== SETTING COMMAND ====================
      if (command === 'setting') {
        const userConfig = await loadUserConfigFromSupabase(sessionNumber) || {};
        const workType = userConfig.WORK_TYPE || 'public';

        const settingText = `⚙️ *Bot Settings*
━━━━━━━━━━━━━━━━━━
🔧 *Work Type:* ${workType}
🔣 *Prefix:* ${prefix}
🤖 *Bot Name:* Red Mini
━━━━━━━━━━━━━━━━━━
📌 *Commands to change settings:*
${prefix}wtype public/groups/inbox/private
━━━━━━━━━━━━━━━━━━
${FOOTER}`;

        await socket.sendMessage(from, { text: settingText }, { quoted: msg });
        return;
      }

      // ==================== WORK TYPE COMMAND ====================
      if (command === 'wtype') {
        if (!isOwner) {
          await socket.sendMessage(from, { text: '❌ Permission denied' }, { quoted: msg });
          return;
        }
        const type = args[0];
        if (!type || !['public', 'groups', 'inbox', 'private'].includes(type)) {
          await socket.sendMessage(from, { text: '⚙️ *Usage:* .wtype public/groups/inbox/private' }, { quoted: msg });
          return;
        }

        const userConfig = await loadUserConfigFromSupabase(sessionNumber) || {};
        userConfig.WORK_TYPE = type;
        await setUserConfigInSupabase(sessionNumber, userConfig);

        await socket.sendMessage(from, { text: `✅ Work type updated to: ${type}` }, { quoted: msg });
        return;
      }

      // ==================== GOOGLE COMMAND ====================
      if (command === 'google') {
        const query = args.join(' ');
        if (!query) {
          await socket.sendMessage(from, { text: '🔍 *Usage:* .google <search query>' }, { quoted: msg });
          return;
        }

        try {
          const response = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { timeout: EXTERNAL_REQUEST_TIMEOUT });
          const $ = cheerio.load(response.data);
          const results = [];

          $('.tF2Cxc').slice(0, 5).each((i, el) => {
            const title = $(el).find('h3').text();
            const link = $(el).find('a').attr('href');
            if (title && link) {
              results.push(`📌 *${title}*\n🔗 ${link}\n`);
            }
          });

          if (results.length === 0) {
            await socket.sendMessage(from, { text: '❌ No results found' }, { quoted: msg });
          } else {
            await socket.sendMessage(from, {
              text: `🔍 *Google Search: ${query}*\n━━━━━━━━━━━━━━━━━━\n${results.join('\n')}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}`
            }, { quoted: msg });
          }

        } catch (err) {
          await socket.sendMessage(from, { text: '❌ Search failed' }, { quoted: msg });
        }
        return;
      }

      // ==================== DELETE SESSION ====================
      if (command === 'deleteme') {
        const senderNum = senderNumber;
        if (!isOwner) {
          await socket.sendMessage(from, { text: '❌ Permission denied' }, { quoted: msg });
          return;
        }

        stoppedSessions.add(sessionNumber);
        revokingSessions.add(sessionNumber);
        try {
          await authStores.get(socket)?.waitOpen();
          await authStores.get(socket)?.stop();
          try { await socket.logout(); } catch (err) { socket.end?.(err); }
          activeSockets.delete(sessionNumber);
          connectingSockets.delete(sessionNumber);
          await removeSessionFromSupabase(sessionNumber);
        } finally { revokingSessions.delete(sessionNumber); }
        await socket.sendMessage(from, { text: '✅ Session deleted successfully' }, { quoted: msg }).catch(() => {});
        return;
      }

      // ==================== BROADCAST COMMAND ====================
      if (command === 'broadcast') {
        if (!isOwner) {
          await socket.sendMessage(from, { text: '❌ Owner only command' }, { quoted: msg });
          return;
        }

        const message = args.join(' ');
        if (!message) {
          await socket.sendMessage(from, { text: '📢 *Usage:* .broadcast <message>' }, { quoted: msg });
          return;
        }

        const numbers = await getAllNumbersFromSupabase();
        for (const num of numbers) {
          try {
            const jid = `${num}@s.whatsapp.net`;
            await socket.sendMessage(jid, { text: `📢 *Broadcast*\n━━━━━━━━━━━━━━━━━━\n${message}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}` });
          } catch (e) {}
        }

        await socket.sendMessage(from, { text: `✅ Broadcast sent to ${numbers.length} users` }, { quoted: msg });
        return;
      }

      // ==================== ADMIN COMMANDS ====================
      if (command === 'admin') {
        if (!isOwner) {
          await socket.sendMessage(from, { text: '❌ Owner only command' }, { quoted: msg });
          return;
        }

        const action = args[0];
        const target = args[1];

        if (action === 'add' && target) {
          await addAdminToSupabase(target);
          await socket.sendMessage(from, { text: `✅ ${target} added as admin` }, { quoted: msg });
        } else if (action === 'remove' && target) {
          await removeAdminFromSupabase(target);
          await socket.sendMessage(from, { text: `✅ ${target} removed from admins` }, { quoted: msg });
        } else if (action === 'list') {
          const admins = await loadAdminsFromSupabase();
          await socket.sendMessage(from, { text: `👥 *Admins*\n━━━━━━━━━━━━━━━━━━\n${admins.join('\n') || 'No admins'}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}` }, { quoted: msg });
        } else {
          await socket.sendMessage(from, { text: '👥 *Admin Commands*\n.admin add <jid>\n.admin remove <jid>\n.admin list' }, { quoted: msg });
        }
        return;
      }

      // ==================== NEWSLETTER COMMANDS ====================
      if (command === 'newsletter') {
        if (!isOwner) {
          await socket.sendMessage(from, { text: '❌ Owner only command' }, { quoted: msg });
          return;
        }

        const action = args[0];
        const jid = args[1];
        const emojis = args.slice(2);

        if (action === 'add' && jid) {
          await addNewsletterToSupabase(jid, emojis);
          await socket.sendMessage(from, { text: `✅ Newsletter ${jid} added` }, { quoted: msg });
        } else if (action === 'remove' && jid) {
          await removeNewsletterFromSupabase(jid);
          await socket.sendMessage(from, { text: `✅ Newsletter ${jid} removed` }, { quoted: msg });
        } else if (action === 'list') {
          const newsletters = await listNewslettersFromSupabase();
          const listText = newsletters.map(n => `📰 ${n.jid}\n   Emojis: ${n.emojis.join(', ')}`).join('\n\n');
          await socket.sendMessage(from, { text: `📰 *Newsletters*\n━━━━━━━━━━━━━━━━━━\n${listText || 'No newsletters'}\n━━━━━━━━━━━━━━━━━━\n${FOOTER}` }, { quoted: msg });
        } else {
          await socket.sendMessage(from, { text: '📰 *Newsletter Commands*\n.newsletter add <jid> [emojis]\n.newsletter remove <jid>\n.newsletter list' }, { quoted: msg });
        }
        return;
      }

      // ==================== DEFAULT ====================
        commandError = new Error(`Unknown command: ${prefix}${command}`);
        await socket.sendMessage(from, {
          text: `❌ Unknown command: ${prefix}${command}\nUse ${prefix}menu to view available commands.`
        }, { quoted: msg });
        return;

  } catch (err) {
    commandError = err;
    console.error(`Command error (${prefix}${command}):`, err?.stack || err);
    const detail = String(err?.message || err || 'Unknown error').replace(/\s+/g, ' ').slice(0, 240);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ ${prefix}${command} failed: ${detail}` }, { quoted: msg }).catch(() => {});
  } finally {
    if (commandStarted) safeCommandReaction(socket, from, msg.key, commandError ? '❌' : '✅').catch(() => {});
  }
  }
  });
}

function setupProtectionHandlers(socket) {
  socket.ev.on('messages.update', async updates => {
    for (const update of updates || []) {
      await protectionPlugin.onRevocation(socket, update).catch(error => console.error('Protection revocation hook error:', error.message));
    }
  });
}

// ========== STATUS HANDLERS ==========
async function setupStatusHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.key || msg.key.remoteJid !== 'status@broadcast') return;

    try {
      const userConfig = await loadUserConfigFromSupabase(sessionNumber) || {};
      const autoView = userConfig.AUTO_VIEW_STATUS ?? config.AUTO_VIEW_STATUS;
      const autoLike = userConfig.AUTO_LIKE_STATUS ?? config.AUTO_LIKE_STATUS;
      if (autoView === 'true') {
        await socket.readMessages([msg.key]);
      }
      if (autoLike === 'true') {
        const emojis = userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI;
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await socket.sendMessage(msg.key.remoteJid, {
          react: { text: randomEmoji, key: msg.key }
        }, { statusJidList: [msg.key.participant] });
      }
    } catch (err) {
      console.error('Status handler error:', err);
    }
  });
}

async function setupWelcomeHandlers(socket) {
  socket.ev.on('group-participants.update', async update => {
    if (!update || update.action !== 'add' || !update.id || !Array.isArray(update.participants) || !update.participants.length) return;
    try {
      const names = update.participants.map(participant => `@${String(participant).split('@')[0].split(':')[0]}`);
      const welcomeMessage = process.env.WELCOME_MESSAGE || 'Enjoy the group.';
      const welcomeText = `╭─❍ WELCOME TO RED XMD ❍─╮\n┃  ⌬ ${names.join(', ')}\n┃  ⌬ ${welcomeMessage}\n╰────────────────────────╯\n\n${FOOTER}`;
      try {
        await socket.sendMessage(update.id, {
          image: { url: getImageUrl('welcome') },
          caption: welcomeText,
          mentions: update.participants
        });
      } catch (mediaError) {
        console.warn('Welcome artwork failed; sending text welcome:', mediaError.message);
        await socket.sendMessage(update.id, {
          text: welcomeText,
          mentions: update.participants
        });
      }
    } catch (err) {
      console.error('Welcome handler error:', err.message);
    }
  });
}

// ========== CALL REJECTION HANDLER ==========
async function setupCallRejection(socket, sessionNumber) {
  socket.ev.on('call', async (calls) => {
    try {
      const userConfig = await loadUserConfigFromSupabase(sessionNumber) || {};
      if (userConfig.ANTI_CALL !== 'on') return;
      for (const call of calls) {
        if (call.status !== 'offer') continue;
        await socket.rejectCall(call.id, call.from);
        await socket.sendMessage(call.from, { text: '🔕 Auto call rejection is enabled.' });
      }
    } catch (err) { console.error('Call handler error:', err.message); }
  });
}

// ========== NEWSLETTER REACTION HANDLER ==========
async function setupNewsletterHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.key) return;
    try {
      const jid = msg.key.remoteJid;
      const newsletter = (await listNewslettersFromSupabase()).find(n => n.jid === jid);
      if (!newsletter) return;
      const emojis = newsletter.emojis.length ? newsletter.emojis : config.AUTO_LIKE_EMOJI;
      const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
      await socket.sendMessage(jid, { react: { text: randomEmoji, key: msg.key } });
    } catch (err) { console.error('Newsletter reaction error:', err.message); }
  });
}

// ========== PAIRING AND SESSION LIFECYCLE ==========
function waitForPairingReady(socket, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('WhatsApp pairing timed out')), timeoutMs);
    const finish = err => {
      clearTimeout(timer);
      socket.ev.off('connection.update', onUpdate);
      err ? reject(err) : resolve();
    };
    const onUpdate = update => {
      if (update.qr) finish();
      else if (update.connection === 'close') {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const reason = update.lastDisconnect?.error?.message || 'unknown reason';
        finish(new Error(`WhatsApp connection closed${statusCode ? ` (${statusCode})` : ''}: ${reason}`));
      }
    };
    socket.ev.on('connection.update', onUpdate);
  });
}
async function EmpirePair(number, requestCode = false) {
  if (typeof number !== 'string' || !/^\d{10,15}$/.test(number)) throw new Error('Invalid phone number');
  if (closingSessions.has(number)) await closingSessions.get(number);
  if (revokingSessions.has(number)) throw new Error('Session is being removed');
  if (!requestCode && stoppedSessions.has(number)) return { status: 'pairing_required' };
  if (activeSockets.has(number)) return { status: 'already_connected' };
  if (inFlight.has(number)) return inFlight.get(number);
  const existing = connectingSockets.get(number);
  if (existing) return existing.code ? { code: existing.code } : { status: 'connecting' };

  if (connectingSockets.size + inFlight.size >= 10) throw new Error('Too many pending sessions');
  const operation = (async () => {
    if (requestCode) stoppedSessions.delete(number);
    const authStore = supabase
      ? await useSupabaseAuthState(supabase, number)
      : await useFileAuthState(localStore.DATA_DIR, number);
    const { state, saveCreds } = authStore;
    if (!requestCode && !state.creds.registered) return { status: 'pairing_required' };
    const logger = pino({ level: 'fatal' });
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      // Safari is a supported WhatsApp Web identity and avoids the stale
      // Ubuntu/Chrome fingerprint that was being rejected during pairing.
      browser: Browsers.macOS('Safari'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: false
    });
    guardSocketSender(socket, number);
    const entry = { socket, code: null, timer: null, opening: Promise.resolve() };
    authStores.set(socket, { ...authStore, waitOpen: () => entry.opening });
    if (!state.creds.registered) {
      entry.timer = setTimeout(() => {
        if (connectingSockets.get(number) === entry) {
          connectingSockets.delete(number);
          socket.end?.(new Error('Pairing attempt expired'));
        }
      }, config.OTP_EXPIRY);
      entry.timer.unref?.();
    }
    connectingSockets.set(number, entry);
    socketCreationTime.set(number, Date.now());

    // Register every handler before requesting a code or returning to the caller.
    socket.ev.on('creds.update', () => {
      saveCreds().catch(err => console.error('Failed to save credentials:', err.message));
    });
    socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        if (connectingSockets.get(number) !== entry) return;
        clearTimeout(entry.timer);
        connectingSockets.delete(number);
        activeSockets.set(number, socket);
        entry.opening = (async () => {
          const connectionWelcome = process.env.CONNECTION_WELCOME_MESSAGE || 'Red Mini bot is connected and ready.';
          const connectedText = `🔴 *RED MINI BOT CONNECTED* 🔴\n✅ Connected: +${number}\n💬 ${connectionWelcome}\n⏱️ Time: ${getSouthAfricaTimestamp()}\n🎨 Image theme: ${require('./lib/image-themes').getActiveImageTheme()?.name || 'Redragon'}\n${FOOTER}`;
          const targetNumber = phoneNumberFromJid(socket.user?.id) || number;
          const target = `${targetNumber}@s.whatsapp.net`;
          const notify = (async () => {
            try {
              await sendWithTimeout(socket, target, {
                image: { url: getImageUrl('welcome') },
                caption: connectedText
              });
            } catch (mediaError) {
              console.warn('Connected artwork failed; sending text notification:', mediaError.message);
              await sendWithTimeout(socket, target, { text: connectedText });
            }
          })();
          const persist = addNumberToSupabase(number);
          const results = await Promise.allSettled([notify, persist]);
          for (const result of results) {
            if (result.status === 'rejected') console.error('Connection setup failed:', result.reason?.message || result.reason);
          }
        })();
        await entry.opening;
      } else if (connection === 'close') {
        clearTimeout(entry.timer);
        if (connectingSockets.get(number) === entry) connectingSockets.delete(number);
        if (activeSockets.get(number) === socket) activeSockets.delete(number);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (stoppedSessions.has(number)) return;
        if (statusCode === DisconnectReason.loggedOut) {
          stoppedSessions.add(number);
          revokingSessions.add(number);
          try { await entry.opening; await authStore.stop(); await removeSessionFromSupabase(number); }
          catch (err) { console.error('Could not remove logged-out session:', err.message); }
          finally { revokingSessions.delete(number); }
        } else if (state.creds.registered) {
          const closing = authStore.flush();
          closingSessions.set(number, closing);
          try { await closing; }
          catch (err) { console.error('Cannot reconnect without saved credentials:', err.message); return; }
          finally { if (closingSessions.get(number) === closing) closingSessions.delete(number); }
          const timer = setTimeout(() => {
            if (!stoppedSessions.has(number)) EmpirePair(number).catch(err => console.error('Reconnect failed:', err.message));
          }, 3000);
          timer.unref?.();
        }
      }
    });
    setupCommandHandlers(socket, number);
    setupStatusHandlers(socket, number);
    setupProtectionHandlers(socket);
    setupWelcomeHandlers(socket);
    setupCallRejection(socket, number);
    setupNewsletterHandlers(socket, number);

    if (state.creds.registered) return { status: 'connecting' };
    try {
      await waitForPairingReady(socket);
      let lastError;
      for (let i = 0; i < config.MAX_RETRIES; i++) {
        try {
          // This Baileys fork defaults to a fixed code unless null is passed.
          entry.code = await socket.requestPairingCode(number, null);
          if (!entry.code) throw new Error('No pairing code returned');
          await authStore.flush();
          return { code: entry.code };
        } catch (err) {
          lastError = err;
          if (i + 1 < config.MAX_RETRIES) await delay(2000);
        }
      }
      throw lastError || new Error('Unable to request pairing code');
    } catch (err) {
      clearTimeout(entry.timer);
      if (connectingSockets.get(number) === entry) connectingSockets.delete(number);
      socket.end?.(err);
      throw err;
    }
  })();
  inFlight.set(number, operation);
  try { return await operation; } finally { inFlight.delete(number); }
}

function getActiveSessions() {
  return Array.from(activeSockets.keys());
}

async function checkDatabase() {
  if (!supabase) return 'local';
  let timer;
  try {
    const result = await Promise.race([
      supabase.from('numbers').select('number').limit(1),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Database timeout')), 4000); })
    ]);
    return result.error ? 'unavailable' : 'connected';
  } catch (_) {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

async function startSavedSessions() {
  if (process.env.RED_DASHBOARD_ONLY === '1') {
    console.log('Dashboard-only mode: refusing to restore WhatsApp sessions.');
    return [];
  }
  const numbers = await getAllNumbersFromSupabase();
  const results = [];
  for (const number of numbers) {
    try { results.push({ number, ...(await EmpirePair(number)) }); }
    catch (err) { console.error(`Could not start saved session: ${err.message}`); results.push({ number, status: 'error' }); }
  }
  return results;
}

// ========== ROUTES ==========
const requestCounts = new Map();

router.post('/', async (req, res) => {
  if (process.env.RED_DASHBOARD_ONLY === '1') {
    return res.status(503).json({ error: 'WhatsApp lifecycle is disabled in dashboard-only mode', dashboardOnly: true });
  }
  const now = Date.now();
  for (const [ip, entry] of requestCounts) if (entry.expires <= now) requestCounts.delete(ip);
  const entry = requestCounts.get(req.ip) || { count: 0, expires: now + 60000 };
  if (++entry.count > 20) return res.status(429).json({ error: 'Too many requests; try again later' });
  requestCounts.set(req.ip, entry);
  const input = req.body?.number;
  if (typeof input !== 'string' || !/^[+\d\s()-]+$/.test(input)) {
    return res.status(400).json({ error: 'Enter a phone number with its country code' });
  }
  const number = input.replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(number)) return res.status(400).json({ error: 'Invalid phone number' });
  try { return res.json(await EmpirePair(number, true)); }
  catch (err) {
    console.error('Pairing request failed:', err.message);
    return res.status(502).json({ error: 'Unable to generate a pairing code. Please try again.' });
  }
});

router.get('/active', (req, res) => {
  res.json({ botName: BOT_NAME, count: activeSockets.size, timestamp: getSouthAfricaTimestamp() });
});
router.get('/ping', (req, res) => {
  res.json({ status: 'active', botName: BOT_NAME, sessions: activeSockets.size });
});

router.post('/connect-all', async (req, res) => {
  if (process.env.RED_DASHBOARD_ONLY === '1') {
    return res.status(503).json({ error: 'WhatsApp lifecycle is disabled in dashboard-only mode', dashboardOnly: true });
  }
  try {
    const results = await startSavedSessions();
    res.json({ status: 'success', attempted: results.length, failed: results.filter(r => r.status === 'error').length,
      pairingRequired: results.filter(r => r.status === 'pairing_required').length });
  } catch (err) {
    console.error('Reconnect request failed:', err.message);
    res.status(502).json({ error: 'Unable to load saved sessions' });
  }
});

module.exports = router;
module.exports.getActiveSessions = getActiveSessions;
module.exports.checkDatabase = checkDatabase;
module.exports.startSavedSessions = startSavedSessions;
module.exports.isTransientConnectionError = isTransientConnectionError;
module.exports.getMessageIdentityNumbers = getMessageIdentityNumbers;
module.exports.isOwnerMessage = isOwnerMessage;
