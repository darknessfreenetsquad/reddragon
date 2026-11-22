'use strict';

const config = require('./config');

module.exports = {
  packname: process.env.PACKNAME || 'Red Mini',
  author: process.env.MEDIA_AUTHOR || 'Red Dragon',
  botName: process.env.BOT_NAME || config.BOT_NAME,
  botOwner: process.env.OWNER_NAME || config.OWNER_NAME,
  ownerNumber: process.env.OWNER_NUMBER || config.OWNER_NUMBER || '',
  giphyApiKey: process.env.GIPHY_API_KEY || '',
  commandMode: process.env.COMMAND_MODE || 'public',
  maxStoreMessages: Number(process.env.MAX_STORE_MESSAGES || 20),
  storeWriteInterval: Number(process.env.STORE_WRITE_INTERVAL || 10000),
  description: process.env.BOT_DESCRIPTION || 'Red Mini WhatsApp bot for media, group commands, and automation.',
  version: process.env.BOT_VERSION || config.BOT_VERSION,
  updateZipUrl: process.env.UPDATE_ZIP_URL || 'https://github.com/darknessfreenetsquad/red-mini-trialX/archive/refs/heads/main.zip',
  knightApiUrl: process.env.KNIGHT_API_URL || 'https://knightbotapi.stream',
  knightApiKey: process.env.KNIGHT_API_KEY || '',
  mediaApiUrl: process.env.MEDIA_API_URL || 'https://knightbotapi.stream',
  mediaApiKey: process.env.MEDIA_API_KEY || '',
  princeApiUrl: process.env.PRINCE_API_URL || 'https://api.princetechn.com',
  princeApiKey: process.env.PRINCE_API_KEY || ''
};
