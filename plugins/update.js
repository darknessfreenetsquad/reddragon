'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const { redDragon } = require('../lib/response-style');

const runFile = promisify(execFile);
const REPOSITORY = process.env.BOT_REPOSITORY || 'darknessfreenetsquad/red-mini-trialX';

async function localCommit() {
  try {
    const { stdout } = await runFile('git', ['rev-parse', 'HEAD'], { timeout: 5000 });
    return stdout.trim();
  } catch (_) {
    return null;
  }
}

async function latestCommit() {
  const { data } = await axios.get(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
    timeout: 15000,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'red-mini-bot-update-check' }
  });
  return { sha: data?.sha || null, message: data?.commit?.message?.split('\n')[0] || 'Latest GitHub commit' };
}

module.exports = {
  commands: ['update'],
  localCommit,
  latestCommit,
  async run(ctx) {
    const { socket, from, msg, footer, isOwner } = ctx;
    if (!isOwner) {
      await socket.sendMessage(from, { text: redDragon('BOT UPDATE', ['Owner only.'], footer) }, { quoted: msg });
      return;
    }
    try {
      const [current, latest] = await Promise.all([localCommit(), latestCommit()]);
      if (current && latest.sha && current === latest.sha) {
        await socket.sendMessage(from, { text: redDragon('BOT UPDATE', ['This deployment is already on the latest repository commit.', `Commit: ${current.slice(0, 12)}`], footer) }, { quoted: msg });
        return;
      }
      await socket.sendMessage(from, { text: redDragon('BOT UPDATE AVAILABLE', [
        `Repository: ${REPOSITORY}`,
        `Latest: ${latest.sha ? latest.sha.slice(0, 12) : 'unknown'}`,
        `Message: ${latest.message}`,
        'This command does not modify a running deployment.',
        'Update safely on the host with: git pull origin main, then restart the bot.'
      ], footer) }, { quoted: msg });
    } catch (error) {
      await socket.sendMessage(from, { text: redDragon('BOT UPDATE ERROR', [error.message], footer) }, { quoted: msg });
    }
  }
};
