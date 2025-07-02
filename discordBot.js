const { Client, GatewayIntentBits } = require('discord.js');
const { enablePublicMode, disablePublicMode } = require('./publicMode');

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
        announceToChannels('Roomba has restarted!');

        
});

client.on('messageCreate', (message) => {
    if (message.content.toLowerCase().startsWith('roomba public')) {

        // Check if the message is from a bot to avoid loops
        if (message.author.bot) return;
        //check if the message is from a whitelisted user
        if (!config.discordBot.administratorIDs.includes(message.author.id)) return

        command = null

        try{
        command = message.content.split(" ")[2].toLowerCase()
        } catch {

        }

        if(command){

            message.reply(command);

            if(command === 'on') {
                enablePublicMode()
                announceToChannels(`Public mode ENABLED!\n${config.discordBot.hostingURL}`)
            } else if(command === 'off') {
                disablePublicMode()
                announceToChannels('Public mode DISABLED.')
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


module.exports = {
  startDiscordBot,
  stopDiscordBot,
};
