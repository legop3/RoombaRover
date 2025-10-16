const { io } = require('../globals/wsSocketExpress');
const { port } = require('../globals/serialConnection');
const { createLogger } = require('../helpers/logger');
const { driveDirect, playRoombaSong } = require('../helpers/roombaCommands');
const { speak } = require('../services/tts');
const accessControl = require('../services/accessControl');
const turnHandler = require('../services/turnHandler');
const sensorService = require('../services/sensorService');
const { startAV } = require('../services/mediaMTX');
const randomWord = require('all-random-words');
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
]);

const accessControlState = accessControl.state;

function generateDefaultNickname() {
    try {
        return randomWord();
    } catch {
        return `User ${Math.random().toString(36).slice(-4)}`;
    }
}

io.use((socket, next) => {
    if (!socket.nickname) {
        socket.nickname = generateDefaultNickname(socket.id);
    }
    next();
});

let clientsOnline = 0;

async function broadcastUserList() {
    try {
        const sockets = await io.fetchSockets();
        const users = sockets.map((s) => ({
            id: s.id,
            authenticated: s.authenticated,
            nickname: s.nickname || generateDefaultNickname(s.id),
        }));
        io.emit('userlist', users);
    } catch (error) {
        socketLogger.error('Failed to broadcast user list', error);
    }
}

function sanitizeNickname(rawNickname) {
    if (typeof rawNickname !== 'string') return '';
    const trimmed = rawNickname.trim();
    if (!trimmed) return '';
    const cleaned = trimmed.replace(/[^A-Za-z0-9 _\-]/g, '');
    return cleaned.slice(0, 24);
}

io.on('connection', async (socket) => {
    socket.nickname = generateDefaultNickname(socket.id);
    socket.emit('nickname:update', { userId: socket.id, nickname: socket.nickname });

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
    clientsOnline += 1;
    io.emit('usercount', clientsOnline);
    await broadcastUserList();

    startAV().catch(() => {});

    if (socket.isAdmin) {
        socket.emit('admin-login', accessControlState.mode);
        socketLogger.debug(`Admin ${socket.id} login; mode=${accessControlState.mode}`);
    }

    socket.on('setNickname', async (rawNickname) => {
        const sanitized = sanitizeNickname(rawNickname);
        const nickname = sanitized || generateDefaultNickname(socket.id);

        if (socket.nickname === nickname) {
            socket.emit('nickname:update', { userId: socket.id, nickname });
            return;
        }

        socket.nickname = nickname;
        const payload = { userId: socket.id, nickname };
        socket.emit('nickname:update', payload);
        socket.broadcast.emit('nickname:update', payload);

        await broadcastUserList();

        if (typeof turnHandler.forceBroadcast === 'function') {
            turnHandler.forceBroadcast();
        }
    });

    socket.on('disconnect', async () => {
        socketLogger.info(`User disconnected: ${socket.id}`);
        clientsOnline = Math.max(0, clientsOnline - 1);
        io.emit('usercount', clientsOnline);
        await broadcastUserList();
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

    socket.on('userMessage', (data = {}) => {
        const rawMessage = typeof data.message === 'string' ? data.message : '';
        const message = rawMessage.trim().slice(0, 240);
        if (!message) return;

        const nickname = socket.nickname || generateDefaultNickname(socket.id);
        const payload = {
            message,
            nickname,
            userId: socket.id,
            timestamp: Date.now(),
        };

        if (data.beep) {
            playRoombaSong(port, 0, [[60, 15]]);
            commandLogger.debug('Chat beep requested');
            speak(message);
        }

        io.emit('userMessageRe', payload);
    });

    socket.on('userTyping', (data = {}) => {
        if (!data.beep) return;
        if (typeof data.message === 'string' && data.message.length === 1) {
            playRoombaSong(port, 1, [[58, 15]]);
            commandLogger.debug('Typing beep triggered');
        }
    });
});
