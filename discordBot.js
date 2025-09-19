const { Client, GatewayIntentBits, ActivityType, ChannelType, PermissionFlagsBits } = require('discord.js');
const { enablePublicMode, disablePublicMode, isPublicMode } = require('./publicMode');
const roombastatus = require('./roombaStatus');

var config = require('./config.json')

let client;

function ensureClientReady() {
  if (!client || !client.isReady()) {
    throw new Error('Discord bot is not ready.');
  }
}

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

        
});

client.on('messageCreate', (message) => {
    if (message.content.toLowerCase().startsWith('rp')) {

        // Check if the message is from a bot to avoid loops
        if (message.author.bot) return;
        //check if the message is from a whitelisted user
        if (!config.discordBot.administratorIDs.includes(message.author.id)) return

        command = null

        try{
        command = message.content.split(" ")[1].toLowerCase()
        } catch {

        }

        if(command){

            message.reply(command);

            if(command === 'on') {
                enablePublicMode()
                announceToChannels(`Public mode ENABLED! Battery at ${roombastatus.batteryPercentage}%\n${config.discordBot.hostingURL}`)
                updatePresence()
                // client.user.setPresence({
                //     activities: [{
                //         type: ActivityType.Custom,
                //         name: `Public Mode ON: ${config.discordBot.hostingURL}`
                //     }]
                // })

            } else if(command === 'off') {
                disablePublicMode()
                announceToChannels(`Public mode DISABLED. Battery at ${roombastatus.batteryPercentage}%`)
                updatePresence()
                // client.user.setPresence({
                //     activities: [{
                //         type: ActivityType.Custom,
                //         name: 'Public Mode OFF'
                //     }]
                // })

            } else {
                message.reply('Command not recognized')
            }

        }

    }
});

  client.login(token).catch(console.error);
}

function stopDiscordBot() {
  if (client) {
    client.destroy();
    console.log('🛑 Discord bot stopped.');
  }
}

async function getAvailableChannels() {
  ensureClientReady();

  const channels = [];

  const guilds = await client.guilds.fetch();
  for (const [guildId] of guilds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const fetchedChannels = await guild.channels.fetch();

      fetchedChannels.forEach(channel => {
        if (!channel || channel.type !== ChannelType.GuildText) return;
        const permissions = channel.permissionsFor(client.user);
        if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.AttachFiles)) return;

        channels.push({
          id: channel.id,
          name: channel.name,
          guild: guild.name
        });
      });
    } catch (error) {
      console.error(`Failed to fetch channels for guild ${guildId}:`, error);
    }
  }

  channels.sort((a, b) => {
    if (a.guild !== b.guild) {
      return a.guild.localeCompare(b.guild);
    }
    return a.name.localeCompare(b.name);
  });

  return channels;
}

async function sendImageToChannel(channelId, imageBuffer, description) {
  ensureClientReady();

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Unable to locate the selected Discord channel.');
  }

  const permissions = channel.permissionsFor(client.user);
  if (!permissions?.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.AttachFiles)) {
    throw new Error('The bot is missing permission to post images in that channel.');
  }

  await channel.send({
    content: description,
    files: [{ attachment: imageBuffer, name: `roomba-rover-${Date.now()}.jpg` }]
  });

  return {
    id: channel.id,
    name: channel.name,
    guild: channel.guild?.name || ''
  };
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


function updatePresence() {
    if (!client || !client.isReady()) {
        console.error('Discord bot is not ready.');
        return;
    }

    publicMode = isPublicMode();
    const activityName = publicMode ? `🔋${roombastatus.batteryPercentage}%. PUBLIC MODE ON: ${config.discordBot.hostingURL}` : `Battery ${roombastatus.batteryPercentage}% Public Mode OFF`;
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


module.exports = {
  startDiscordBot,
  stopDiscordBot,
  getAvailableChannels,
  sendImageToChannel,
};
