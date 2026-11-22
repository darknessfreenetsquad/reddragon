'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getActiveImageTheme, setActiveImageTheme } = require('./image-themes');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const BAR = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄';
const FIXED_STRINGS = {
  global: {
    headerName: '𝙍𝙀𝘿 𝙓𝙈𝘿',
    botName: '🔴 RED DRAGON DFS',
    footer: '© ʀᴇᴅ ᴅʀᴀɢᴏɴ ᴅғs'
  }
};

// Text themes were retired. Artwork is now the only selectable theme system.
function listThemes() {
  return [];
}

function loadTheme() {
  return null;
}

function getActiveTheme() {
  return FIXED_STRINGS;
}

function getActiveThemeName() {
  return getActiveImageTheme()?.name || config.IMAGE_THEME || 'Redragon';
}

function setActiveTheme(name) {
  return setActiveImageTheme(name);
}

function getStr(key) {
  return FIXED_STRINGS.global[key] || null;
}

function getPluginCount() {
  if (!fs.existsSync(PLUGINS_DIR)) return 0;
  return fs.readdirSync(PLUGINS_DIR).filter(file => file.endsWith('.js')).length;
}

function getSouthAfricanTime() {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
}

function getHeader(prefix = config.PREFIX || '.') {
  const name = getStr('headerName');
  return [
    `╭─ׁ━❍─↻${name}↺─❍━╮`,
    `┃  ⌬ ${getSouthAfricanTime()}`,
    `┃  ⌬ ${getPluginCount()} plugins loaded`,
    `┃  ⌬ Prefix: \`${prefix}\``,
    `┃  ⌬ IMAGE THEME: ${getActiveThemeName()}`,
    `╰${BAR}╯`
  ];
}

function getFooter(prefix = config.PREFIX || '.') {
  return [
    `╭${BAR}╮`,
    `┃  💡 \`${prefix}help <cmd>\``,
    `┃  ${getStr('footer')}`,
    `╰${BAR}╯`,
    `╰─ׁ━❍─↻${getStr('headerName')}↺─❍━╯`
  ];
}

function fmt(body, prefix = config.PREFIX || '.') {
  const lines = String(body || '').trim().split('\n');
  const content = lines.map(line => line ? `┃  ⌬ ${line}` : '┃');
  return [...getHeader(prefix), ...content, ...getFooter(prefix)].join('\n');
}

function redDragon(title, lines = [], fallbackFooter = '') {
  const body = [`*${title}*`, ...lines.filter(Boolean)];
  const formatted = fmt(body.join('\n'));
  return formatted || fallbackFooter;
}

function isThemedText(value) {
  return typeof value === 'string' && value.includes(getStr('headerName'));
}

module.exports = {
  listThemes,
  loadTheme,
  getActiveTheme,
  getActiveThemeName,
  setActiveTheme,
  getStr,
  getPluginCount,
  getSouthAfricanTime,
  getHeader,
  getFooter,
  fmt,
  redDragon,
  isThemedText
};
