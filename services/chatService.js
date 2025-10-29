const { io } = require('../globals/wsSocketExpress');
const { port } = require('../globals/serialConnection');
const { createLogger } = require('../helpers/logger');
const { cleanProfanity } = require('../helpers/profanityFilter');
const { playRoombaSong } = require('../helpers/roombaCommands');
const { speak, resolveVoice, DEFAULT_TTS_VOICE } = require('./tts');
const ChatSpamFilter = require('./chatSpamFilter');

const logger = createLogger('ChatService');
const spamLogger = logger.child('Spam');
const spamFilter = new ChatSpamFilter();

function deriveSocketDisplayName(socket) {
    if (!socket) return 'User';
    if (typeof socket.nickname === 'string') {
        const trimmed = socket.nickname.trim();
        if (trimmed) {
            return trimmed.slice(0, 24);
        }
    }
    if (typeof socket.id === 'string') {
        const suffix = socket.id.slice(-6);
        return suffix ? `User ${suffix}` : 'User';
    }
    return 'User';
}

function broadcastChatMessage(payload) {
    io.emit('userMessageRe', payload);
}

function handleUserMessage(socket, data = {}) {
    const rawMessage = typeof data.message === 'string' ? data.message : '';
    const trimmedMessage = rawMessage.trim();
    if (!trimmedMessage) return;

    const clipped = trimmedMessage.slice(0, 240);
    const sanitizedMessage = cleanProfanity(clipped);
    if (!sanitizedMessage) return;

    const nickname = deriveSocketDisplayName(socket);
    const now = Date.now();

    if (!socket?.isAdmin) {
        const result = spamFilter.evaluate(socket.id, sanitizedMessage, now);
        if (!result.allowed) {
            spamLogger.warn(`Blocked chat from ${nickname}: ${result.reason}`);
            socket.emit('alert', result.reason);
            return;
        }
    } else {
        // Admins can bypass the filter but we still clear any stale state
        spamFilter.reset(socket.id);
    }

    const requestedVoice = typeof data.voice === 'string' ? data.voice : DEFAULT_TTS_VOICE;
    const voice = resolveVoice(requestedVoice);

    const payload = {
        message: sanitizedMessage,
        nickname,
        userId: socket.id,
        timestamp: now,
        voice,
    };

    if (data.beep) {
        playRoombaSong(port, 0, [[60, 15]]);
        logger.debug(`Beep requested by ${nickname}`);
        speak(sanitizedMessage, voice);
    }

    broadcastChatMessage(payload);
}

function bindSocketEvents(socket) {
    if (!socket) return;

    socket.on('userMessage', (data) => {
        try {
            handleUserMessage(socket, data);
        } catch (error) {
            logger.error(`Failed to handle chat message from ${socket.id}`, error);
        }
    });

    socket.on('disconnect', () => {
        spamFilter.reset(socket.id);
    });
}

io.on('connection', (socket) => {
    bindSocketEvents(socket);
});

module.exports = {
    broadcastChatMessage,
    deriveSocketDisplayName,
};
