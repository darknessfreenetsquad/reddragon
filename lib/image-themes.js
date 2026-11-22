'use strict';

const fs = require('fs');
const path = require('path');

const THEMES_FILE = path.join(__dirname, '..', 'image-themes.json');
const config = require('../config');
const themes = JSON.parse(fs.readFileSync(THEMES_FILE, 'utf8'));
let activeName = process.env.IMAGE_THEME || config.IMAGE_THEME || 'Redragon';

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function listImageThemes() {
  return Object.keys(themes).sort();
}

function getImageTheme(name = activeName) {
  const key = listImageThemes().find(item => normalizeName(item) === normalizeName(name));
  return key ? { name: key, ...themes[key] } : null;
}

function getActiveImageTheme() {
  return getImageTheme(activeName) || getImageTheme('Redragon');
}

function setActiveImageTheme(name) {
  const selected = getImageTheme(name);
  if (!selected) return false;
  activeName = selected.name;
  return true;
}

function getImageUrl(kind, name) {
  const selected = getImageTheme(name) || getActiveImageTheme();
  const url = selected?.[kind];
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
}

module.exports = {
  listImageThemes,
  getImageTheme,
  getActiveImageTheme,
  setActiveImageTheme,
  getImageUrl
};
