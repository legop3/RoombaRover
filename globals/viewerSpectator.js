const { io } = require('../globals/wsSocketExpress');
const { createLogger } = require('../helpers/logger');
const accessControl = require('../services/accessControl');
// const { subscribeEntities } = require('../services/homeAssistantLights')

const logger = createLogger('ViewerSpectator');

const viewerNamepace = io.of('/viewer');
viewerspace.on('connection', (socket) => {
    socketLogger.debug(`Viewer connected: ${socket.id}`);
    viewerspace.emit('usercount', clientsOnline);
});

const spectateNamespace = io.of('/spectate');
spectateNamespace.on('connection', (socket) => {
    logger.debug(`Spectator connected: ${socket.id}`);
    // viewerspace.emit('usercount', clientsOnline);
    // if (connection) {
    //     subscribeEntities(connection, (entities) => {
    //         const stateArray = getLightStateArray(entities);
    //         socket.emit('light_states', stateArray);
    //     });
    // }
    if(accessControl.state.mode === 'lockdown') {
        socket.emit('disconnect-reason', 'LOCKDOWN_ENABLED');
        return socket.disconnect(true);
    }
    socketLogger.debug(`Spectator connected: ${socket.id}`);
    // viewerspace.emit('usercount', clientsOnline);
});

// SPECTATOR EVENT FORWARDER
function forwardToSpectators(eventName, ...args) {
    spectatespace.emit(eventName, ...args);
    viewerspace.emit(eventName, ...args);
}

// Monkey-patch io.emit to forward all events except internal ones
const INTERNAL_EVENTS = new Set(['connection', 'disconnect', 'disconnecting', 'newListener', 'removeListener']);
const originalEmit = io.emit.bind(io);
io.emit = function(event, ...args) {
    if (!INTERNAL_EVENTS.has(event)) {
        forwardToSpectators(event, ...args);
    }
    return originalEmit(event, ...args);
};

module.exports = {
    viewerNamepace,
    spectateNamespace,
};