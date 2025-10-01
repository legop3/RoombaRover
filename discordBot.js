const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { AccessModes, getControlMode, setControlMode, publicModeEvent } = require('./publicMode');
const roombastatus = require('./roombaStatus');

var config = require('./config.json')

let client;

function startDiscordBot(token) {
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

  client.once('ready', async () => {
        console.log(`✅ Discord bot logged in as ${client.user.tag}`);

        // config.discordBot.announceChannels.forEach(async channel => {

        //     // console.log(channel)
        //     const sendto = await client.channels.fetch(channel)

        //     // console.log(sendto)
        //     sendto.send('Roomba has restarted!')

        //     console.log(client.guilds)

        // });
        // announceToChannels('Roomba has restarted!');


        updatePresence();
});

client.on('messageCreate', (message) => {
    if (!message.content.toLowerCase().startsWith('rp')) {
        return;
    }

    // Check if the message is from a bot to avoid loops
    if (message.author.bot) return;
    //check if the message is from a whitelisted user
    if (!config.discordBot.administratorIDs.includes(message.author.id)) return

    const args = message.content.trim().split(/\s+/).slice(1);
    const subcommand = (args.shift() || '').toLowerCase();

    if (!subcommand) {
        message.reply(getHelpText());
        return;
    }

    if (subcommand === 'mode') {
        const requested = (args.shift() || '').toLowerCase();
        const normalized = normalizeRequestedMode(requested);

        if (!normalized) {
            message.reply('Unknown mode. Available modes: public, turns, admin.');
            return;
        }

        const current = getControlMode();
        if (current === normalized) {
            message.reply(`Control mode is already ${formatModeName(normalized)}.`);
            return;
        }

        setControlMode(normalized);
        message.reply(`Set control mode to ${formatModeName(normalized)}.`);
        return;
    }

    if (subcommand === 'status') {
        const mode = getControlMode();
        message.reply(`Current control mode: ${formatModeName(mode)}. Battery at ${roombastatus.batteryPercentage}%.`);
        return;
    }

    if (subcommand === 'help') {
        message.reply(getHelpText());
        return;
    }

    message.reply('Command not recognized. Try `rp help`.');
});

  client.login(token).catch(console.error);
}

function stopDiscordBot() {
  if (client) {
    client.destroy();
    console.log('🛑 Discord bot stopped.');
  }
}

function announceToChannels(announcement) {
    if (!client || !client.isReady()) {
        console.error('Discord bot is not ready.');
        return;
    }
    
    config.discordBot.announceChannels.forEach(async channelId => {
        try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            channel.send(announcement);
        } else {
            console.error(`Channel with ID ${channelId} not found.`);
        }
        } catch (error) {
        console.error(`Failed to send message to channel ${channelId}:`, error);
        }
    });
}


function formatModeName(mode) {
    switch (mode) {
        case AccessModes.PUBLIC:
            return 'Public';
        case AccessModes.TURNS:
            return 'Turns';
        case AccessModes.ADMIN_ONLY:
            return 'Admin Only';
        default:
            return 'Unknown';
    }
}

function normalizeRequestedMode(mode) {
    switch (mode) {
        case 'public':
            return AccessModes.PUBLIC;
        case 'turns':
        case 'turn':
            return AccessModes.TURNS;
        case 'admin':
        case 'admin-only':
        case 'adminonly':
        case 'private':
            return AccessModes.ADMIN_ONLY;
        default:
            return null;
    }
}

function getHelpText() {
    return 'Commands: `rp mode <public|turns|admin>`, `rp status`, `rp help`.';
}

function updatePresence() {
    if (!client || !client.isReady()) {
        return;
    }

    const mode = getControlMode();
    const activityName = `🔋${roombastatus.batteryPercentage}% | Mode: ${formatModeName(mode)}`;
    client.user.setPresence({
        activities: [{
            type: ActivityType.Custom,
            name: activityName
        }],
        status: 'online'
    });
    console.log(`Discord bot presence set to: ${activityName}`);
}

setInterval(updatePresence, 60000); // Update presence every minute


publicModeEvent.on('controlModeChanged', ({ mode, previous }) => {
    updatePresence();

    if (!previous || previous === mode) {
        return;
    }

    announceToChannels(`Control mode changed: ${formatModeName(previous)} → ${formatModeName(mode)}. Battery at ${roombastatus.batteryPercentage}%.`);
});


module.exports = {
  startDiscordBot,
  stopDiscordBot,
};
