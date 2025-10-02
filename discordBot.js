const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const roombaStatus = require('./roombaStatus');
const config = require('./config.json');

const COMMANDS = ['open', 'turns', 'admin'];
const PRESENCE_INTERVAL_MS = 60_000;

let client = null;
let accessControl;

function modeLabel(mode) {
  if (mode === 'open') return 'Open Play';
  if (mode === 'turns') return 'Turns Mode';
  if (mode === 'admin') return 'Admin Only';
  return mode;
}

function parseCommand(content = '') {
  const parts = content.trim().toLowerCase().split(/\s+/);
  if (!parts[0]) return null;
  if (parts[0] === 'rp') return parts[1] || null;
  return parts[0];
}

function updatePresence() {
  if (!accessControl) accessControl = require('./accessControl');
  const { state } = accessControl;
  const currentMode = state.mode;
  const pieces = [`Battery ${roombaStatus.batteryPercentage}%`, modeLabel(currentMode)];
  if (currentMode === 'open') pieces.push(config.discordBot.hostingURL);

  client.user.setPresence({
    activities: [{ type: ActivityType.Custom, name: pieces.join(' | ') }],
    status: 'online',
  });
}

function announceModeChange(mode) {
  if (!accessControl) accessControl = require('./accessControl');
  const lines = [`Access mode changed to ${modeLabel(mode)}.`, `Battery at ${roombaStatus.batteryPercentage}%.`];
  if (mode === 'open') lines.push(config.discordBot.hostingURL);

  config.discordBot.announceChannels.forEach(async (channelId) => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) await channel.send(lines.join('\n'));
    } catch (error) {
      console.error(`Failed to announce to ${channelId}:`, error);
    }
  });
}

function handleMessage(message) {
  if (message.author.bot) return;
  if (!config.discordBot.administratorIDs.includes(message.author.id)) return;

  if (!accessControl) accessControl = require('./accessControl');
  const { state, changeMode } = accessControl;
  const command = parseCommand(message.content);
  if (!COMMANDS.includes(command)) return;

  if (state.mode === command) {
    message.reply(`Access mode already set to ${modeLabel(command)}.`);
    updatePresence();
    return;
  }

  changeMode(command);
  message.reply(`Access mode set to ${modeLabel(command)}.`);
  announceModeChange(command);
  updatePresence();
}

function startDiscordBot(token) {
  if (client) return;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once('ready', () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
    updatePresence();
    setInterval(updatePresence, PRESENCE_INTERVAL_MS);
  });

  client.on('messageCreate', handleMessage);

  client.login(token).catch((error) => {
    console.error('Failed to login Discord bot:', error);
  });
}

module.exports = {
  startDiscordBot,
};
