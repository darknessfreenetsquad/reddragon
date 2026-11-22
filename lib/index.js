'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_PATH = process.env.RED_USER_GROUP_DATA_PATH || path.join(DATA_DIR, 'userGroupData.json');
const LEGACY_SUDO_PATH = path.join(DATA_DIR, 'sudo.json');

const DEFAULT_DATA = Object.freeze({
  antibadword: {},
  antilink: {},
  antitag: {},
  welcome: {},
  goodbye: {},
  chatbot: {},
  warnings: {},
  sudo: []
});

function defaultData() {
  return {
    antibadword: {},
    antilink: {},
    antitag: {},
    welcome: {},
    goodbye: {},
    chatbot: {},
    warnings: {},
    sudo: []
  };
}

function loadUserGroupData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const data = { ...defaultData(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    if (!Array.isArray(data.sudo)) data.sudo = [];
    return data;
  } catch (_) {
    const data = defaultData();
    // Preserve Red Mini installations that already use data/sudo.json.
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_SUDO_PATH, 'utf8'));
      if (Array.isArray(legacy)) data.sudo = legacy;
    } catch (_) {}
    return data;
  }
}

function saveUserGroupData(data) {
  try {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    const tempPath = `${DATA_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ ...defaultData(), ...data }, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, DATA_PATH);
    return true;
  } catch (error) {
    try { fs.unlinkSync(`${DATA_PATH}.${process.pid}.tmp`); } catch (_) {}
    console.error('Error saving user group data:', error.message);
    return false;
  }
}

function updateSection(section, key, value) {
  const data = loadUserGroupData();
  if (!data[section] || typeof data[section] !== 'object' || Array.isArray(data[section])) data[section] = {};
  data[section][key] = value;
  return saveUserGroupData(data);
}

async function setAntilink(groupId, type, action = 'delete') {
  return updateSection('antilink', groupId, { enabled: type === 'on', action });
}
async function getAntilink(groupId, type) {
  const value = loadUserGroupData().antilink?.[groupId];
  return type === 'on' && value ? value : null;
}
async function removeAntilink(groupId) {
  const data = loadUserGroupData();
  if (data.antilink?.[groupId]) delete data.antilink[groupId];
  return saveUserGroupData(data);
}

async function setAntitag(groupId, type, action = 'delete') {
  return updateSection('antitag', groupId, { enabled: type === 'on', action });
}
async function getAntitag(groupId, type) {
  const value = loadUserGroupData().antitag?.[groupId];
  return type === 'on' && value ? value : null;
}
async function removeAntitag(groupId) {
  const data = loadUserGroupData();
  if (data.antitag?.[groupId]) delete data.antitag[groupId];
  return saveUserGroupData(data);
}

async function incrementWarningCount(groupId, userId) {
  const data = loadUserGroupData();
  if (!data.warnings[groupId]) data.warnings[groupId] = {};
  data.warnings[groupId][userId] = Number(data.warnings[groupId][userId] || 0) + 1;
  const ok = saveUserGroupData(data);
  return ok ? data.warnings[groupId][userId] : 0;
}
async function resetWarningCount(groupId, userId) {
  const data = loadUserGroupData();
  if (data.warnings[groupId]?.[userId] !== undefined) data.warnings[groupId][userId] = 0;
  return saveUserGroupData(data);
}

async function isSudo(userId) {
  return loadUserGroupData().sudo.includes(userId);
}
async function addSudo(userJid) {
  const data = loadUserGroupData();
  if (!data.sudo.includes(userJid)) data.sudo.push(userJid);
  return saveUserGroupData(data);
}
async function removeSudo(userJid) {
  const data = loadUserGroupData();
  data.sudo = data.sudo.filter(jid => jid !== userJid);
  return saveUserGroupData(data);
}
async function getSudoList() {
  return loadUserGroupData().sudo;
}

async function addWelcome(jid, enabled, message) {
  return updateSection('welcome', jid, { enabled: Boolean(enabled), message: message || 'Welcome, {user}!' });
}
async function delWelcome(jid) {
  const data = loadUserGroupData();
  delete data.welcome[jid];
  return saveUserGroupData(data);
}
async function isWelcomeOn(jid) { return Boolean(loadUserGroupData().welcome?.[jid]?.enabled); }
async function getWelcome(jid) { return loadUserGroupData().welcome?.[jid]?.message || null; }

async function addGoodbye(jid, enabled, message) {
  return updateSection('goodbye', jid, { enabled: Boolean(enabled), message: message || 'Goodbye, {user}!' });
}
async function delGoodBye(jid) {
  const data = loadUserGroupData();
  delete data.goodbye[jid];
  return saveUserGroupData(data);
}
async function isGoodByeOn(jid) { return Boolean(loadUserGroupData().goodbye?.[jid]?.enabled); }
async function getGoodbye(jid) { return loadUserGroupData().goodbye?.[jid]?.message || null; }

async function setAntiBadword(groupId, type, action = 'delete') {
  return updateSection('antibadword', groupId, { enabled: type === 'on', action });
}
async function getAntiBadword(groupId, type) {
  const value = loadUserGroupData().antibadword?.[groupId];
  return type === 'on' && value ? value : null;
}
async function removeAntiBadword(groupId) {
  const data = loadUserGroupData();
  delete data.antibadword[groupId];
  return saveUserGroupData(data);
}

async function setChatbot(groupId, enabled) { return updateSection('chatbot', groupId, { enabled: Boolean(enabled) }); }
async function getChatbot(groupId) { return loadUserGroupData().chatbot?.[groupId] || null; }
async function removeChatbot(groupId) {
  const data = loadUserGroupData();
  delete data.chatbot[groupId];
  return saveUserGroupData(data);
}

module.exports = {
  DEFAULT_DATA,
  loadUserGroupData,
  saveUserGroupData,
  setAntilink,
  getAntilink,
  removeAntilink,
  setAntitag,
  getAntitag,
  removeAntitag,
  incrementWarningCount,
  resetWarningCount,
  isSudo,
  addSudo,
  removeSudo,
  getSudoList,
  addWelcome,
  delWelcome,
  isWelcomeOn,
  getWelcome,
  addGoodbye,
  delGoodBye,
  isGoodByeOn,
  getGoodbye,
  setAntiBadword,
  getAntiBadword,
  removeAntiBadword,
  setChatbot,
  getChatbot,
  removeChatbot
};
