const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { enablePublicMode, disablePublicMode, isPublicMode } = require('./publicMode');
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
};
