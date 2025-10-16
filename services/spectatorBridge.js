const { io } = require('../globals/wsSocketExpress');
const { createLogger } = require('../helpers/logger');

const logger = createLogger('SpectatorBridge');

const spectatorNamespace = io.of('/spectate');

const FORWARDED_EVENTS = new Set([
    'SensorData',
    'system-stats',
    'room-camera-frame',
    'userMessageRe',
    'usercount',
    'userlist',
    'light_states',
    'logs',
    'turns:update',
    'warning',
    'alert',
    'message',
    'mode-update'
]);

const originalEmit = io.emit.bind(io);

io.emit = function patchedEmit(event, ...args) {
    const result = originalEmit(event, ...args);
    if (FORWARDED_EVENTS.has(event)) {
        try {
            spectatorNamespace.emit(event, ...args);
        } catch (error) {
            logger.error(`Failed to forward event "${event}" to spectator namespace`, error);
        }
    }
    return result;
};

logger.info(`Spectator bridge active. Forwarding events: ${Array.from(FORWARDED_EVENTS).join(', ')}`);

module.exports = {
    spectatorNamespace,
    forwardedEvents: FORWARDED_EVENTS
};
