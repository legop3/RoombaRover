const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require('discord.js');
const roombaStatus = require('../globals/roombaStatus');
// const { getServer } = require('./ioContext');
const { io } = require('../globals/wsSocketExpress');
const { getDiscordAdminIds } = require('../helpers/adminDirectory');
const config = require('../helpers/config');
const { createLogger } = require('../helpers/logger');

const logger = createLogger('DiscordBot');

const COMMANDS = ['open', 'turns', 'admin', 'lockdown'];
const PRESENCE_INTERVAL_MS = 60_000;
const discordBotConfig = config.discordBot || {};

const IDLE_CHECK_INTERVAL_MS = 20_000;
const IDLE_THRESHOLD_MS = 60_000;
const IDLE_REMINDER_INTERVAL_MS = 10 * 60_000;

function normalizeIdArray(ids) {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

let client = null;
let accessControl;
let idleMonitorTimer = null;
let idleCountdownStartedAt = null;
let lastIdleAlertAt = 0;
let idleEvaluationInProgress = false;

async function alertAdmins(message) {
  if (!client?.isReady()) {
    return false;
  }

  const adminIds = normalizeIdArray(getDiscordAdminIds());
  const channelIds = normalizeIdArray(discordBotConfig.alertChannels);

  if (channelIds.length === 0) {
    return false;
  }

  const adminRoleIds = normalizeIdArray(discordBotConfig.adminRoles);

  const mentionParts = [];
  if (adminRoleIds.length > 0) {
    mentionParts.push(adminRoleIds.map((roleId) => `<@&${roleId}>`).join(' '));
  }
  // if (adminIds.length > 0) {
  //   mentionParts.push(adminIds.map((adminId) => `<@${adminId}>`).join(' '));
  // }

  const mentionText = mentionParts.join(' ').trim();
  const content = mentionText ? `${mentionText} ${message}` : message;

  const tasks = [];

  channelIds.forEach((channelId) => {
    tasks.push((async () => {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased?.()) {
          const payload = {
            content,
          };

          if (mentionText) {
            payload.allowedMentions = {};
            if (adminRoleIds.length > 0) {
              payload.allowedMentions.roles = adminRoleIds;
            }
            if (adminIds.length > 0) {
              payload.allowedMentions.users = adminIds;
            }
          }

          await channel.send(payload);
        } else {
          logger.warn(`Channel ${channelId} is not a text channel. Skipping alert.`);
        }
      } catch (error) {
        logger.error(`Failed to notify channel ${channelId}`, error);
      }
    })());
  });

  await Promise.all(tasks);

  return true;
}

function hasActiveDriver() {
  try {
    // const io = getServer();
    const now = Date.now();
    for (const socket of io.of('/').sockets.values()) {
      if (!socket?.connected) continue;
      if (socket.lastDriveCommandAt && now - socket.lastDriveCommandAt < IDLE_THRESHOLD_MS) {
        return true;
      }
    }
  } catch (error) {
    logger.error('Idle monitor failed to inspect driver sockets', error);
    return true; // Fail-safe to avoid false positives while inspection fails
  }
  return false;
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
    const lastDriveAt = roombaStatus.lastDriveCommandAt || 0;
    const countdownSeed = lastDriveAt || idleCountdownStartedAt || now;

    if (!idleCountdownStartedAt || idleCountdownStartedAt < countdownSeed) {
      idleCountdownStartedAt = countdownSeed;
    }

    if (now - idleCountdownStartedAt < IDLE_THRESHOLD_MS) return;
    if (lastIdleAlertAt && now - lastIdleAlertAt < IDLE_REMINDER_INTERVAL_MS) return;

    await alertAdmins('[Alert] The Roomba appears undocked and nobody is currently driving. Please dock it or hand it off as soon as you can.');
    lastIdleAlertAt = now;
  } finally {
    idleEvaluationInProgress = false;
  }
}

function ensureIdleMonitor() {
  if (idleMonitorTimer || IDLE_CHECK_INTERVAL_MS <= 0) return;
  idleMonitorTimer = setInterval(() => {
    evaluateIdleState().catch((error) => {
      logger.error('Idle monitor evaluation failed', error);
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
  if (!accessControl) accessControl = require('../services/accessControl');
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

function modeColor(mode) {
  if (mode === 'open') return 0x07fc03;
  if (mode === 'turns') return 0xfca503;
  if (mode === 'admin') return 0xfc0303;
  return 0x2b2d31;
}

function announceModeChange(mode) {
  if (!accessControl) accessControl = require('./services/accessControl');

  const embed = new EmbedBuilder()
    .setTitle('Access Mode Update')
    .setDescription(`Access mode changed to **${modeLabel(mode)}**.`)
    .setColor(modeColor(mode))
    .addFields({ name: 'Battery', value: `${roombaStatus.batteryPercentage}%`, inline: true })
    .setTimestamp(new Date());

  if ((mode === 'open' || mode === 'turns') && discordBotConfig.hostingURL) {
    embed.addFields({ name: 'Join Link', value: discordBotConfig.hostingURL, inline: false });
  }

  const watcherRoleIds = normalizeIdArray(discordBotConfig.watcherRoles);

  (discordBotConfig.announceChannels || []).forEach(async (channelId) => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased?.()) {
        const payload = { embeds: [embed] };

        if (watcherRoleIds.length > 0) {
          payload.content = watcherRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
          payload.allowedMentions = { roles: watcherRoleIds };
        }

        await channel.send(payload);
        } else {
          logger.warn(`Channel ${channelId} is not a text channel. Skipping announcement.`);
        }
      } catch (error) {
        logger.error(`Failed to announce to ${channelId}`, error);
      }
  });
}

function announceDoneCharging() {
  const embed = new EmbedBuilder()
    .setTitle('Done Charging!')
    .setDescription('Rover is done charging and ready to drive!')
    .setColor(0x07fc03)
    .addFields({ name: 'Battery', value: `${roombaStatus.batteryPercentage}%`, inline: true})
    .setTimestamp(new Date());

  const watcherRoleIds = normalizeIdArray(discordBotConfig.watcherRoles);

  (discordBotConfig.announceChannels || []).forEach(async (channelId) => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased?.()) {
        const payload = { embeds: [embed] };

        if (watcherRoleIds.length > 0) {
          payload.content = watcherRoleIds.map((roleId) => `<@&${roleId}>`).join(' ');
          payload.allowedMentions = { roles: watcherRoleIds };
        }

        await channel.send(payload);
        } else {
          logger.warn(`Channel ${channelId} is not a text channel. Skipping announcement.`);
        }
      } catch (error) {
        logger.error(`Failed to announce to ${channelId}`, error);
      }
  });
}

function handleMessage(message) {
  if (message.author.bot) return;
  if (!getDiscordAdminIds().includes(message.author.id)) return;

  if (!accessControl) accessControl = require('./services/accessControl');
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
  // announceModeChange(command);
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
    logger.info(`Discord bot logged in as ${client.user.tag}`);
    updatePresence();
    setInterval(updatePresence, PRESENCE_INTERVAL_MS);
    ensureIdleMonitor();
  });

  client.on('messageCreate', handleMessage);

  client.login(token).catch((error) => {
    logger.error('Failed to login Discord bot', error);
  });
}

module.exports = {
  startDiscordBot,
  alertAdmins,
  announceModeChange,
  announceDoneCharging
};
