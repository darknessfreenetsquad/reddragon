'use strict';

const { redDragon } = require('../lib/response-style');

const DEFAULT_EMOJIS = ['❤️', '💗', '🔥', '🥰'];

module.exports = {
  commands: ['statusview'],
  DEFAULT_EMOJIS,
  async run(ctx) {
    const { socket, from, msg, args, footer, isOwner, getUserConfig, setUserConfig } = ctx;
    if (!isOwner) {
      await socket.sendMessage(from, { text: redDragon('STATUS VIEW', ['Owner only.'], footer) }, { quoted: msg });
      return;
    }
    const current = (await getUserConfig?.()) || {};
    const action = String(args[0] || '').toLowerCase();
    const next = { ...current };
    if (action === 'on' || action === 'off') {
      next.AUTO_VIEW_STATUS = action === 'on' ? 'true' : 'false';
    } else if (action === 'like') {
      const value = String(args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) {
        await socket.sendMessage(from, { text: redDragon('STATUS VIEW', ['Usage: .statusview like on|off'], footer) }, { quoted: msg });
        return;
      }
      next.AUTO_LIKE_STATUS = value === 'on' ? 'true' : 'false';
    } else if (action === 'emojis') {
      const emojis = args.slice(1).filter(Boolean);
      if (!emojis.length) {
        await socket.sendMessage(from, { text: redDragon('STATUS EMOJIS', [`Current: ${(current.AUTO_LIKE_EMOJI || DEFAULT_EMOJIS).join(' ')}`, 'Usage: .statusview emojis ❤️ 💗 🔥 🥰'], footer) }, { quoted: msg });
        return;
      }
      next.AUTO_LIKE_EMOJI = emojis.slice(0, 8);
    } else if (action && action !== 'show') {
      await socket.sendMessage(from, { text: redDragon('STATUS VIEW', ['Usage: .statusview', '.statusview on|off', '.statusview like on|off', '.statusview emojis ❤️ 💗 🔥 🥰'], footer) }, { quoted: msg });
      return;
    }
    if (setUserConfig && (action === 'on' || action === 'off' || action === 'like' || action === 'emojis')) await setUserConfig(next);
    const finalConfig = (await getUserConfig?.()) || next;
    await socket.sendMessage(from, { text: redDragon('STATUS VIEW', [
      `Auto view: ${finalConfig.AUTO_VIEW_STATUS === 'false' ? 'OFF' : 'ON'}`,
      `Auto like: ${finalConfig.AUTO_LIKE_STATUS === 'false' ? 'OFF' : 'ON'}`,
      `Reactions: ${(finalConfig.AUTO_LIKE_EMOJI || DEFAULT_EMOJIS).join(' ')}`,
      'Usage: .statusview on|off'
    ], footer) }, { quoted: msg });
  }
};
