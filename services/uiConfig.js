const config = require('../helpers/config');
const { app, io } = require('../globals/wsSocketExpress')
const { createLogger } = require('../helpers/logger')

const logger = createLogger('UIConfig');

function buildUiConfig() {
    const rawInvite = config.discordBot && typeof config.discordBot.inviteURL === 'string'
        ? config.discordBot.inviteURL.trim()
        : '';

    return {
        discordInviteURL: rawInvite || null,
    };
}

// Discord invite API endpoint
app.get('/discord-invite', (req, res) => {
    logger.info('Serving Discord invite URL');
    const { discordInviteURL } = buildUiConfig();
    if (!discordInviteURL) {
        res.status(204).send('');
        return;
    }
    res.type('text/plain').send(discordInviteURL);
});

io.on('connection', (socket) => {
    logger.info(`Client connected for UI config: ${socket.id}`);
    socket.emit('ui-config', buildUiConfig());   
})

module.exports = {
    buildUiConfig,
};