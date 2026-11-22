'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const update = require('../plugins/update');
const { toSticker } = require('../lib/sticker');

test('update plugin defaults to the reddragon repository', () => {
  assert.equal(update.repository, 'darknessfreenetsquad/reddragon');
});

test('image sticker conversion works without invoking FFmpeg', async () => {
  const image = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 4,
      background: { r: 220, g: 30, b: 60, alpha: 1 }
    }
  }).png().toBuffer();
  const sticker = await toSticker(image, 'image/png');
  assert.ok(Buffer.isBuffer(sticker));
  assert.equal(sticker.toString('ascii', 0, 4), 'RIFF');
  assert.equal(sticker.toString('ascii', 8, 12), 'WEBP');
});
