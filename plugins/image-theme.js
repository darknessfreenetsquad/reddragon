'use strict';

const {
  listImageThemes,
  getActiveImageTheme,
  setActiveImageTheme
} = require('../lib/image-themes');
const { redDragon } = require('../lib/theme');

module.exports = {
  commands: ['imagetheme', 'setimage'],
  async run(ctx) {
    const { socket, msg, from, args, isOwner, footer } = ctx;
    if (!isOwner) {
      await socket.sendMessage(from, { text: redDragon('IMAGE THEME', ['Owner only.'], footer) }, { quoted: msg });
      return;
    }

    const requested = args[0];
    if (!requested) {
      const active = getActiveImageTheme();
      await socket.sendMessage(from, {
        text: redDragon('IMAGE THEMES', [
          `Active: ${active.name}`,
          `Available: ${listImageThemes().join(', ')}`,
          'Usage: .imagetheme <name>'
        ], footer)
      }, { quoted: msg });
      return;
    }

    if (!setActiveImageTheme(requested)) {
      await socket.sendMessage(from, {
        text: redDragon('IMAGE THEME', [`Unknown theme: ${requested}`, `Available: ${listImageThemes().join(', ')}`], footer)
      }, { quoted: msg });
      return;
    }

    await socket.sendMessage(from, {
      text: redDragon('IMAGE THEME UPDATED', [`Active: ${getActiveImageTheme().name}`], footer)
    }, { quoted: msg });
  }
};
