'use strict';

const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment-timezone');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unixTimestampSeconds = (date = new Date()) => Math.floor(date.getTime() / 1000);

async function fetchJson(url, options = {}) {
  const response = await axios({ method: 'GET', url, timeout: options.timeout || 30000, ...options, headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) } });
  return response.data;
}

async function fetchBuffer(url, options = {}) {
  const response = await axios({ method: 'GET', url, responseType: 'arraybuffer', timeout: options.timeout || 60000, ...options, headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) } });
  return { buffer: Buffer.from(response.data), headers: response.headers, status: response.status };
}

const fetchUrl = fetchJson;
const getBuffer = async (url, options) => (await fetchBuffer(url, options)).buffer;
const getImg = getBuffer;

function getRandom(ext = '') {
  const suffix = String(ext || '');
  return `${crypto.randomBytes(6).toString('hex')}${suffix.startsWith('.') ? suffix : suffix ? `.${suffix}` : ''}`;
}
function isUrl(value) { return /^https?:\/\/[^\s]+$/i.test(String(value || '')); }
function isNumber(value) { return /^\d+$/.test(String(value || '').trim()); }
function runtime(seconds) {
  let remaining = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(remaining / 86400); remaining %= 86400;
  const hours = Math.floor(remaining / 3600); remaining %= 3600;
  const minutes = Math.floor(remaining / 60); const secs = Math.floor(remaining % 60);
  return [[days, 'day'], [hours, 'hour'], [minutes, 'minute'], [secs, 'second']].filter(([n]) => n).map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`).join(', ') || '0 seconds';
}
function clockString(ms) { return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(value => String(Number.isFinite(value) ? value : 0).padStart(2, '0')).join(':'); }
function getTime(format = 'HH:mm', date) { return (date ? moment(date) : moment.tz('Africa/Johannesburg')).format(format); }
function formatDate(value, locale = 'en-ZA') { return new Date(value).toLocaleString(locale); }
function bytesToSize(bytes, decimals = 2) { if (!bytes) return '0 Bytes'; const i = Math.floor(Math.log(bytes) / Math.log(1024)); return `${parseFloat((bytes / 1024 ** i).toFixed(Math.max(0, decimals)))} ${['Bytes', 'KB', 'MB', 'GB', 'TB'][i] || 'PB'}`; }
function parseMention(text = '') { return [...String(text).matchAll(/@([0-9]{5,16})/g)].map(match => `${match[1]}@s.whatsapp.net`); }
function getGroupAdmins(participants = []) { return participants.filter(item => ['admin', 'superadmin'].includes(item.admin)).map(item => item.id).filter(Boolean); }

module.exports = {
  sleep, unixTimestampSeconds, generateMessageTag: epoch => `${unixTimestampSeconds()}${epoch ? `.--${epoch}` : ''}`,
  processTime: (timestamp, now = unixTimestampSeconds()) => now - Number(timestamp),
  fetchJson, fetchBuffer, fetchUrl, getBuffer, getImg, getRandom, isUrl, isNumber,
  runtime, clockString, getTime, formatDate, bytesToSize, parseMention, getGroupAdmins,
  json: value => JSON.stringify(value, null, 2)
};
