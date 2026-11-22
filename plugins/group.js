'use strict';

const axios = require('axios');
const { redDragon } = require('../lib/response-style');
const { toSticker } = require('./converter');

function jidFromValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
}

function contextInfo(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo || {};
}

function mentionedOrQuoted(ctx) {
  const info = contextInfo(ctx.msg);
  const values = [...(info.mentionedJid || [])];
  if (info.participant) values.push(info.participant);
  return values.map(jidFromValue).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

async function requireGroupAdmin(ctx, botAction = true) {
  const { socket, from, msg, isGroup, isGroupAdmin, isBotAdmin, footer } = ctx;
  if (!isGroup) {
    await socket.sendMessage(from, { text: redDragon('GROUP COMMAND', ['This command only works inside a WhatsApp group.'], footer) }, { quoted: msg });
    return false;
  }
  if (!isGroupAdmin && !ctx.isOwner) {
    await socket.sendMessage(from, { text: redDragon('GROUP COMMAND', ['Only a group admin or bot owner can use this command.'], footer) }, { quoted: msg });
    return false;
  }
  if (botAction && !isBotAdmin && !ctx.isOwner) {
    await socket.sendMessage(from, { text: redDragon('GROUP COMMAND', ['Make the bot a group admin first.'], footer) }, { quoted: msg });
    return false;
  }
  return true;
}

function participantJid(participant) {
  return participant?.id || participant?.jid || null;
}

function jidIdentity(value) {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

async function sendGroupStatus(ctx, title, target, text) {
  await ctx.socket.sendMessage(target, {
    text: redDragon(title, [text], ctx.footer)
  }, { quoted: target === ctx.from ? ctx.msg : undefined });
}

module.exports = {
  commands: ['kick', 'kickall', 'tgstickers', 'mute', 'open', 'adddescription', 'addstgroup', 'addstchannel'],
  async run(ctx) {
    const { socket, from, msg, args, command, footer, groupMetadata } = ctx;

    if (command === 'tgstickers') {
      const url = args[0];
      if (/^https?:\/\//i.test(url || '') && !/t\.me\/addstickers\//i.test(url)) {
        try {
          const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 10 * 1024 * 1024 });
          const mime = response.headers?.['content-type'] || 'image/webp';
          if (!mime.startsWith('image/')) throw new Error('The URL did not return an image.');
          await socket.sendMessage(from, { sticker: await toSticker({ buffer: Buffer.from(response.data), mime, fileName: 'telegram-sticker' }) }, { quoted: msg });
          return;
        } catch (error) {
          await socket.sendMessage(from, { text: redDragon('TG STICKERS ERROR', [error.message], footer) }, { quoted: msg });
          return;
        }
      }
      await socket.sendMessage(from, { text: redDragon('TG STICKERS', [
        'Use .tgstickers <direct .webp or image URL>.',
        'Telegram pack pages need a Telegram bot token and are not scraped.'
      ], footer) }, { quoted: msg });
      return;
    }

    if (command === 'addstchannel') {
      if (!ctx.isOwner) {
        await socket.sendMessage(from, { text: redDragon('CHANNEL STATUS', ['Owner only.'], footer) }, { quoted: msg });
        return;
      }
      const target = process.env.NEWSLETTER_JID || '';
      const text = args.join(' ').trim();
      if (!target || !text) {
        await socket.sendMessage(from, { text: redDragon('CHANNEL STATUS', ['Usage: .addstchannel <status text>', 'Set NEWSLETTER_JID first.'], footer) }, { quoted: msg });
        return;
      }
      await sendGroupStatus(ctx, 'CHANNEL STATUS', target, text);
      await socket.sendMessage(from, { text: redDragon('CHANNEL STATUS', ['Status sent successfully.'], footer) }, { quoted: msg });
      return;
    }

    if (!await requireGroupAdmin(ctx, command !== 'addstgroup')) return;

    if (command === 'addstgroup') {
      const text = args.join(' ').trim();
      if (!text) {
        await socket.sendMessage(from, { text: redDragon('GROUP STATUS', ['Usage: .addstgroup <status text>'], footer) }, { quoted: msg });
        return;
      }
      await sendGroupStatus(ctx, 'GROUP STATUS', from, text);
      return;
    }

    if (command === 'adddescription') {
      const description = args.join(' ').trim();
      if (!description) {
        await socket.sendMessage(from, { text: redDragon('GROUP DESCRIPTION', ['Usage: .adddescription <new description>'], footer) }, { quoted: msg });
        return;
      }
      await socket.groupUpdateDescription(from, description);
      await socket.sendMessage(from, { text: redDragon('GROUP DESCRIPTION', ['Description updated.'], footer) }, { quoted: msg });
      return;
    }

    if (command === 'mute' || command === 'open') {
      await socket.groupSettingUpdate(from, command === 'mute' ? 'announcement' : 'not_announcement');
      await socket.sendMessage(from, { text: redDragon(command === 'mute' ? 'GROUP MUTED' : 'GROUP OPEN', [
        command === 'mute' ? 'Only admins can send messages now.' : 'All participants can send messages now.'
      ], footer) }, { quoted: msg });
      return;
    }

    const candidates = unique([
      ...mentionedOrQuoted(ctx),
      ...args.map(jidFromValue).filter(Boolean)
    ]);
    const participants = groupMetadata?.participants || [];
    const botIdentities = new Set([socket.user?.id, socket.user?.lid]
      .map(jidIdentity).filter(Boolean));
    const protectedJids = new Set(participants.filter(participant =>
      ['admin', 'superadmin'].includes(participant.admin) || botIdentities.has(jidIdentity(participantJid(participant)))
    ).map(participantJid));

    if (command === 'kick') {
      const targets = candidates.filter(jid => !protectedJids.has(jid) && !botIdentities.has(jidIdentity(jid)));
      if (!targets.length) {
        await socket.sendMessage(from, { text: redDragon('KICK', ['Mention, reply to, or provide the number of a participant. Admins and the bot are protected.'], footer) }, { quoted: msg });
        return;
      }
      await socket.groupParticipantsUpdate(from, targets, 'remove');
      await socket.sendMessage(from, { text: redDragon('KICK', [`Removed ${targets.length} participant(s).`], footer) }, { quoted: msg });
      return;
    }

    if (command === 'kickall') {
      const targets = participants.map(participantJid).filter(Boolean).filter(jid => !protectedJids.has(jid));
      if (!targets.length) {
        await socket.sendMessage(from, { text: redDragon('KICKALL', ['No removable participants found.'], footer) }, { quoted: msg });
        return;
      }
      await socket.groupParticipantsUpdate(from, targets, 'remove');
      await socket.sendMessage(from, { text: redDragon('KICKALL', [`Removed ${targets.length} non-admin participant(s).`], footer) }, { quoted: msg });
    }
  }
};

module.exports.requireGroupAdmin = requireGroupAdmin;
