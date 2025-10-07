const { getServer } = require('./ioContext');
const { createLogger } = require('./logger');
const config = require('./config');
const { createConnection, createLongLivedTokenAuth, callService, subscribeEntities, createSocket } = require('home-assistant-js-websocket');
const WebSocket = require('ws');

const io = getServer();
const logger = createLogger('HomeAssistantLights');

const haConfig = config?.homeAssistantLights || {}
const haURL = haConfig.serverURL || ""
const haToken = haConfig.accessToken || ""
const lightEntities = haConfig.lightEntities || {}

let connection = null;
let socket = null;

global.WebSocket = WebSocket;

if(!haConfig.enabled) {
    logger.info('Home Assistant Lights integration is disabled in config.');
} else if (!haURL || !haToken || Object.keys(lightEntities).length === 0) {
    logger.error('Home Assistant Lights integration is enabled but not properly configured! Please check config.yaml');
} else {
    logger.info(`Home Assistant Lights integration enabled. Controlling entities: ${Object.values(lightEntities).join(', ')}`);
    logger.info(`Home Assistant server URL: ${haURL}`);
    initHomeAssistant();
}

async function initHomeAssistant() {
    try{
        const auth = createLongLivedTokenAuth(haURL, haToken);
        connection = await createConnection({ auth });
        logger.info('Connected to Home Assistant WebSocket API');
        subscribeLightStates();
        setupSocketListeners();
    } catch (error) {
        logger.error('Failed to connect to Home Assistant:', error.message);
        return;
    }
}

function getLightStateArray(entities) {
    return Object.values(lightEntities).map(entityId => {
        const stateObj = entities[entityId];
        return stateObj ? stateObj.state === 'on' : false;
    });
}

let lastLightStateArray = null;

function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function subscribeLightStates() {
    subscribeEntities(connection, (entities) => {
        const stateArray = getLightStateArray(entities);
        if (!arraysEqual(stateArray, lastLightStateArray)) {
            logger.info('Received light states from Home Assistant:', stateArray);
            io.emit('light_states', stateArray);
            logger.info('Emitted light states to socket.io clients');
            lastLightStateArray = stateArray;
        }
    });
}

io.on('connection', (client) => {
    // Send current states on connect
    if (connection) {
        subscribeEntities(connection, (entities) => {
            const stateArray = getLightStateArray(entities);
            client.emit('light_states', stateArray);
        });
    }
    client.on('light_switch', async (data) => {
        // data: { index, state }
        if (!data || typeof data.index !== 'number' || typeof data.state !== 'boolean') return;
        const entityId = Object.values(lightEntities)[data.index];
        if (!entityId) return;
        const service = data.state ? 'turn_on' : 'turn_off';
        await callEntityService(service, entityId, client);
    });
});

const spectatespace = io.of('/spectate');
spectatespace.on('connection', (client) => {
    logger.debug(`Spectator connected: ${client.id}`);
    // viewerspace.emit('usercount', clientsOnline);
    if (connection) {
        subscribeEntities(connection, (entities) => {
            const stateArray = getLightStateArray(entities);
            client.emit('light_states', stateArray);
        });
    }

});

async function callEntityService(service, entityId, client) {
    if (!connection) {
        logger.error('No connection to Home Assistant.');
        client.emit('entity_error', { entityId, error: 'No connection to Home Assistant.' });
        return;
    }
    let domain = '';
    if (entityId.startsWith('light.')) {
        domain = 'light';
    } else if (entityId.startsWith('switch.')) {
        domain = 'switch';
    } else {
        logger.error(`Unsupported entity domain for ${entityId}`);
        client.emit('entity_error', { entityId, error: 'Unsupported entity domain.' });
        return;
    }
    try {
        await callService(connection, domain, service, { entity_id: entityId });
        logger.info(`Called service ${service} for ${entityId}`);
        client.emit('entity_success', { entityId, service });
    } catch (error) {
        logger.error(`Error calling service ${service} for ${entityId}:`, error.message);
        client.emit('entity_error', { entityId, error: error.message });
    }
}

