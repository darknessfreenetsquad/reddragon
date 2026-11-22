'use strict';

const { redDragon } = require('../lib/response-style');

const truths = [
  'What is your biggest fear?', 'What is the biggest lie you have told?',
  'What is something you have never told anyone?', 'What is your biggest regret?',
  'What is the last thing you searched online?'
];
const dares = [
  'Send a funny selfie to the group.', 'Share your most embarrassing moment.',
  'Send a voice note singing your favourite song.', 'Change your profile picture for ten minutes.',
  'Send a voice note imitating a celebrity.'
];

module.exports = {
  commands: ['truth', 'dare', 'rps'],
  async run(ctx) {
    const { socket, from, msg, command, args, footer } = ctx;
    if (command === 'truth' || command === 'dare') {
      const pool = command === 'truth' ? truths : dares;
      const item = pool[Math.floor(Math.random() * pool.length)];
      await socket.sendMessage(from, { text: redDragon(command.toUpperCase(), [item], footer) }, { quoted: msg });
      return;
    }

    const choices = ['rock', 'paper', 'scissors'];
    const userChoice = args[0]?.toLowerCase();
    if (!choices.includes(userChoice)) {
      await socket.sendMessage(from, { text: redDragon('ROCK PAPER SCISSORS', ['Choose: rock, paper, or scissors', 'Example: .rps rock'], footer) }, { quoted: msg });
      return;
    }
    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    const win = (userChoice === 'rock' && botChoice === 'scissors') ||
      (userChoice === 'paper' && botChoice === 'rock') ||
      (userChoice === 'scissors' && botChoice === 'paper');
    const result = userChoice === botChoice ? 'Tie.' : win ? 'You win.' : 'Red Dragon wins.';
    await socket.sendMessage(from, {
      text: redDragon('ROCK PAPER SCISSORS', [`You: ${userChoice}`, `Red Dragon: ${botChoice}`, result], footer)
    }, { quoted: msg });
  }
};
