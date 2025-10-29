const { io } = require('../globals/wsSocketExpress');
const { spectatorNamespace } = require('./spectatorBridge');
const { port } = require('../globals/serialConnection');
const { createLogger } = require('../helpers/logger');
const { driveDirect, playRoombaSong } = require('../helpers/roombaCommands');
const accessControl = require('../services/accessControl');
const turnHandler = require('../services/turnHandler');
const sensorService = require('../services/sensorService');
const { startAV } = require('../services/mediaMTX');
const { spawn } = require('child_process');

const logger = createLogger('Server');
const socketLogger = logger.child('Socket');
const commandLogger = logger.child('Command');

const EVENT_ALLOWED_WHEN_NOT_DRIVING = new Set([
    'setNickname',
    'userMessage',
    'userTyping',
    'set-spectate-mode',
    'light_switch',
    'emergency:initiate',
    'emergency:cancel',
]);

const accessControlState = accessControl.state;

async function fetchPresenceSnapshots() {
    try {
        const [driverSockets, spectatorSockets] = await Promise.all([
            io.fetchSockets(),
            spectatorNamespace?.fetchSockets?.() ?? Promise.resolve([]),
        ]);

        const mapSocket = (socket, isSpectator) => ({
            id: socket.id,
            authenticated: Boolean(socket.authenticated),
            isAdmin: Boolean(socket.isAdmin),
            isSpectator,
            nickname: typeof socket.nickname === 'string'
                ? socket.nickname.trim().slice(0, 24)
                : '',
        });

        const driverUsers = driverSockets.map((socket) => mapSocket(socket, false));
        const spectatorUsers = spectatorSockets.map((socket) => mapSocket(socket, true));
        return [...driverUsers, ...spectatorUsers];
    } catch (error) {
        socketLogger.error('Failed to broadcast user list', error);
        return [];
    }
}

async function broadcastUserPresence() {
    const users = await fetchPresenceSnapshots();
    const total = users.length;
    io.emit('usercount', total);
    io.emit('userlist', users);
}

function sanitizeNickname(rawNickname) {
    if (typeof rawNickname !== 'string') return '';
    const trimmed = rawNickname.trim();
    if (!trimmed) return '';
    const cleaned = trimmed.replace(/[^A-Za-z0-9 _\-]/g, '');
    return cleaned.slice(0, 24);
}

io.on('connection', async (socket) => {
    socket.use((packet, next) => {
        const eventName = Array.isArray(packet) ? packet[0] : undefined;
        if (EVENT_ALLOWED_WHEN_NOT_DRIVING.has(eventName)) {
            return next();
        }
        if (socket.driving || socket.isAdmin) {
            return next();
        }
        socket.emit('alert', 'You are not currently driving.');
    });

    socketLogger.info(`User connected: ${socket.id}`);
    await broadcastUserPresence();

    startAV().catch(() => {});

    if (socket.isAdmin) {
        socket.emit('admin-login', accessControlState.mode);
        socketLogger.debug(`Admin ${socket.id} login; mode=${accessControlState.mode}`);
    }

    socket.on('setNickname', async (rawNickname) => {
        const sanitized = sanitizeNickname(rawNickname);
        const nickname = sanitized || null;

        if (socket.nickname === nickname) {
            socket.emit('nickname:update', { userId: socket.id, nickname: nickname ?? '' });
            return;
        }

        socket.nickname = nickname;
        const payload = { userId: socket.id, nickname: nickname ?? '' };
        socket.emit('nickname:update', payload);
        socket.broadcast.emit('nickname:update', payload);

        await broadcastUserPresence();

        if (typeof turnHandler.forceBroadcast === 'function') {
            turnHandler.forceBroadcast();
        }
    });

    socket.on('disconnect', async () => {
        socketLogger.info(`User disconnected: ${socket.id}`);
        await broadcastUserPresence();
        driveDirect(0, 0);
    });

    socket.on('requestSensorData', () => {
        sensorService.startPolling();
    });

    socket.on('set-spectate-mode', (mode) => {
        socketLogger.debug(`Spectate mode update from ${socket.id}: ${mode}`);
    });

    socket.on('rebootServer', () => {
        if (!socket.isAdmin) return;
        commandLogger.warn(`Reboot requested by ${socket.id}`);
        spawn('sudo', ['reboot']);
    });

    socket.on('userTyping', (data = {}) => {
        if (!data.beep) return;
        if (typeof data.message === 'string' && data.message.length === 1) {
            playRoombaSong(port, 1, [[58, 15]]);
            commandLogger.debug('Typing beep triggered');
        }
    });
});

spectatorNamespace.on('connection', async (socket) => {
    await broadcastUserPresence();

    socket.on('disconnect', async () => {
        await broadcastUserPresence();
    });
});
