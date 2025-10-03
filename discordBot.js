const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const roombaStatus = require('./roombaStatus');
const { getServer } = require('./ioContext');
const config = require('./config.json');

const COMMANDS = ['open', 'turns', 'admin'];
const PRESENCE_INTERVAL_MS = 60_000;
const discordBotConfig = config.discordBot || {};
const IDLE_CHECK_INTERVAL_MS = 30_000;
const IDLE_THRESHOLD_MS = 5 * 60_000;
const IDLE_REMINDER_INTERVAL_MS = 60 * 60_000;

let client = null;
let accessControl;
let idleMonitorTimer = null;
let idleCountdownStartedAt = null;
let lastIdleAlertAt = 0;
let idleEvaluationInProgress = false;

function hasActiveDriver() {
  try {
    const io = getServer();
    for (const socket of io.of('/').sockets.values()) {
      if (socket?.connected && socket.driving) {
        return true;
      }
    }
  } catch (error) {
    console.error('Idle monitor failed to inspect driver sockets:', error);
    return true; // Fail-safe to avoid false positives while inspection fails
  }
  return false;
}

async function notifyAdminsRoombaIdle() {
  const adminIds = discordBotConfig.administratorIDs || [];
  if (!client?.isReady() || adminIds.length === 0) return;

  const message = '[Alert] The Roomba appears undocked and nobody is currently driving. Please dock it or hand it off as soon as you can.';

  await Promise.all(adminIds.map(async (adminId) => {
    try {
      const user = await client.users.fetch(adminId);
      if (user) await user.send(message);
    } catch (error) {
      console.error(`Failed to notify admin ${adminId} about idle rover:`, error);
    }
  }));
}

async function evaluateIdleState() {
  if (idleEvaluationInProgress) return;
  idleEvaluationInProgress = true;

  try {
    if (!client?.isReady()) return;

    const undocked = roombaStatus.docked === false;
    if (!undocked) {
      idleCountdownStartedAt = null;
      if (roombaStatus.docked === true) {
        lastIdleAlertAt = 0;
      }
      return;
    }

    if (hasActiveDriver()) {
      idleCountdownStartedAt = null;
      return;
    }

    const now = Date.now();
    if (!idleCountdownStartedAt) {
      idleCountdownStartedAt = now;
      return;
    }

    if (now - idleCountdownStartedAt < IDLE_THRESHOLD_MS) return;
    if (lastIdleAlertAt && now - lastIdleAlertAt < IDLE_REMINDER_INTERVAL_MS) return;

    await notifyAdminsRoombaIdle();
    lastIdleAlertAt = now;
  } finally {
    idleEvaluationInProgress = false;
  }
}

function ensureIdleMonitor() {
  if (idleMonitorTimer || IDLE_CHECK_INTERVAL_MS <= 0) return;
  idleMonitorTimer = setInterval(() => {
    evaluateIdleState().catch((error) => {
      console.error('Idle monitor evaluation failed:', error);
    });
  }, IDLE_CHECK_INTERVAL_MS);
}

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
  if (currentMode === 'open' && discordBotConfig.hostingURL) {
    pieces.push(discordBotConfig.hostingURL);
  }

  client.user.setPresence({
    activities: [{ type: ActivityType.Custom, name: pieces.join(' | ') }],
    status: 'online',
  });
}

function announceModeChange(mode) {
  if (!accessControl) accessControl = require('./accessControl');
  const lines = [`Access mode changed to ${modeLabel(mode)}.`, `Battery at ${roombaStatus.batteryPercentage}%.`];
  if (mode === 'open' && discordBotConfig.hostingURL) {
    lines.push(discordBotConfig.hostingURL);
  }

  (discordBotConfig.announceChannels || []).forEach(async (channelId) => {
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
  if (!(discordBotConfig.administratorIDs || []).includes(message.author.id)) return;

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
    ensureIdleMonitor();
  });

  client.on('messageCreate', handleMessage);

  client.login(token).catch((error) => {
    console.error('Failed to login Discord bot:', error);
  });
}

module.exports = {
  startDiscordBot,
};
