'use strict';

const { redDragon, fmt, isThemedText } = require('./theme');

function cleanFileName(value, fallback = 'red-dragon-file') {
  return (value || fallback).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80);
}

module.exports = { redDragon, fmt, isThemedText, cleanFileName };
