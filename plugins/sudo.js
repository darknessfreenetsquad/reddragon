'use strict';

const { addSudo, removeSudo, getSudoList } = require('../lib/index');
const { redDragon } = require('../lib/response-style');

function targetFromContext(ctx) {
  const info = ctx.msg?.message?.extendedTextMessage?.contextInfo || {};
  if (info.mentionedJid?.[0]) return info.mentionedJid[0];
  const raw = ctx.args.join(' ');
  const match = raw.match(/\b\d{7,15}\b/);
  return match ? `${match[0]}@s.whatsapp.net` : null;
}

module.exports = {
  commands: ['sudo'],
  async run(ctx) {
    const { socket, from, msg, args, footer, isOwner } = ctx;
    const sub = String(args[0] || '').toLowerCase();
    if (!['add', 'del', 'remove', 'list'].includes(sub)) {
      await socket.sendMessage(from, { text: redDragon('SUDO', ['Usage: .sudo add <@user|number>', '.sudo del <@user|number>', '.sudo list'], footer) }, { quoted: msg });
      return;
    }

    const users = await getSudoList();
    if (sub === 'list') {
      await socket.sendMessage(from, { text: redDragon('SUDO', [users.length ? users.map((jid, i) => `${i + 1}. ${jid}`).join('\n') : 'No sudo users set.'], footer) }, { quoted: msg });
      return;
    }
    if (!isOwner) {
      await socket.sendMessage(from, { text: redDragon('SUDO', ['Only the owner can add or remove sudo users.'], footer) }, { quoted: msg });
      return;
    }

    const target = targetFromContext(ctx);
    if (!target) {
      await socket.sendMessage(from, { text: redDragon('SUDO', ['Mention a user or provide a number.'], footer) }, { quoted: msg });
      return;
    }
    if ((sub === 'del' || sub === 'remove') && target.replace(/\D/g, '') === String(ctx.ownerNumber || '').replace(/\D/g, '')) {
      await socket.sendMessage(from, { text: redDragon('SUDO', ['The owner cannot be removed.'], footer) }, { quoted: msg });
      return;
    }

    const ok = sub === 'add' ? await addSudo(target) : await removeSudo(target);
    await socket.sendMessage(from, { text: redDragon('SUDO', [ok ? (sub === 'add' ? `Added sudo: ${target}` : `Removed sudo: ${target}`) : 'Unable to update sudo users.'], footer) }, { quoted: msg });
  }
};
