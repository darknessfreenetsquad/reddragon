'use strict';

const { redDragon } = require('../lib/theme');
const { getImageUrl, getActiveImageTheme } = require('../lib/image-themes');

async function sendWithTimeout(socket, jid, message, options, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      socket.sendMessage(jid, message, options),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Message send timed out')), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  commands: ['alive', 'ping'],
  async run(ctx) {
    const { socket, msg, from, command, footer, ownerNumber, botName, getUptime } = ctx;
    if (command === 'ping') {
      const started = Date.now();
      await socket.sendMessage(from, { react: { text: '⏳', key: msg.key } });
      const latency = Date.now() - started;
      const speed = latency < 100 ? 'Excellent' : latency < 300 ? 'Good' : 'Slow';
      const theme = getActiveImageTheme()?.name || 'Redragon';
      const pong = redDragon('PONG', [`Latency: ${latency}ms`, `Speed: ${speed}`, `Image Theme: ${theme}`], footer);
      try {
        await sendWithTimeout(socket, from, { image: { url: getImageUrl('ping') }, caption: pong }, { quoted: msg });
      } catch (error) {
        console.error('Ping artwork failed; sending text fallback:', error.message);
        await sendWithTimeout(socket, from, { text: pong }, { quoted: msg });
      }
      return;
    }

    const uptime = getUptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const imageTheme = getActiveImageTheme();
    const online = redDragon('BOT ONLINE', [`Bot: ${botName}`, `Owner: ${ownerNumber || 'Not configured'}`, `Uptime: ${hours}h ${minutes}m ${seconds}s`, 'Status: Active', 'Region: South Africa', `Image Theme: ${imageTheme.name}`], footer);
    try {
      await sendWithTimeout(socket, from, { image: { url: getImageUrl('welcome') }, caption: online }, { quoted: msg });
    } catch (error) {
      console.error('Alive artwork failed; sending text fallback:', error.message);
      await sendWithTimeout(socket, from, { text: online }, { quoted: msg });
    }
  }
};
