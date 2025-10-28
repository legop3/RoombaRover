const { io } = require('../globals/wsSocketExpress');
const { spectatorNamespace } = require('./spectatorBridge');
const { createLogger } = require('../helpers/logger');
const roombaStatus = require('../globals/roombaStatus');
const { triggerOwnerAlertScript } = require('./homeAssistantLights');
const { alertAdmins } = require('./discordBot');

const COUNTDOWN_DURATION_MS = 60_000;
const RESET_AFTER_RESULT_MS = 15_000;
const CONFIRMATION_PHRASE = 'confirm';

const logger = createLogger('Emergency');

const emergencyState = {
    active: false,
    startedAt: 0,
    initiatorId: null,
    initiatorNickname: '',
    countdownTimer: null,
    tickInterval: null,
};

let lastOutcome = null;
let resetTimer = null;

function runAlert(nickname, batteryCharge, batteryCapacity, mode) {
    const initiator = typeof nickname === 'string' && nickname.trim() ? nickname.trim() : 'Unknown';
    const friendlyMode = resolveOiMode(mode);
    const safeCharge = Number.isFinite(batteryCharge) ? batteryCharge : null;
    const safeCapacity = Number.isFinite(batteryCapacity) ? batteryCapacity : null;

    logger.info(`Owner alert fired by ${initiator} | charge=${safeCharge ?? 'n/a'}/${safeCapacity ?? 'n/a'} | mode=${friendlyMode}`);

    const tasks = [];

    if (typeof triggerOwnerAlertScript === 'function') {
        tasks.push(
            triggerOwnerAlertScript({
                initiator,
                batteryCharge: safeCharge,
                batteryCapacity: safeCapacity,
                oiMode: friendlyMode,
            })
        );
    }

    if (typeof alertAdmins === 'function') {
        const parts = [`Owner alert triggered by ${initiator}.`];
        if (safeCharge !== null && safeCapacity !== null) {
            parts.push(`Battery ${safeCharge}/${safeCapacity}`);
        }
        parts.push(`OI mode: ${friendlyMode}.`);
        parts.push('Please respond ASAP.');
        tasks.push(alertAdmins(parts.join(' ')));
    }

    if (tasks.length) {
        Promise.allSettled(tasks).then((results) => {
            results.forEach((result) => {
                if (result.status === 'rejected') {
                    logger.error('Owner alert side-effect failed', result.reason);
                }
            });
        }).catch((error) => {
            logger.error('Owner alert side-effect handling failed', error);
        });
    }
}


function deriveNickname(socket) {
    if (!socket) return 'User';
    if (typeof socket.nickname === 'string') {
        const trimmed = socket.nickname.trim();
        if (trimmed) {
            return trimmed.slice(0, 24);
        }
    }
    if (socket.adminProfile && typeof socket.adminProfile?.name === 'string') {
        const trimmed = socket.adminProfile.name.trim();
        if (trimmed) {
            return trimmed.slice(0, 24);
        }
    }
    if (typeof socket.id === 'string' && socket.id.length) {
        const suffix = socket.id.slice(-6);
        if (suffix) {
            return `User ${suffix}`;
        }
    }
    return 'User';
}

function resolveOiMode(value) {
    switch (value) {
        case 0: return 'Off';
        case 1: return 'Passive';
        case 2: return 'Safe';
        case 3: return 'Full';
        case 4: return 'Full';
        default: return 'Unknown';
    }
}

function safeNumber(value) {
    return Number.isFinite(value) ? value : null;
}

function buildTelemetrySnapshot() {
    const charge = safeNumber(roombaStatus.batteryCharge);
    const capacity = safeNumber(roombaStatus.batteryCapacity);
    const voltageRaw = safeNumber(roombaStatus.batteryVoltage);
    const voltage = voltageRaw !== null ? Number((voltageRaw / 1000).toFixed(2)) : null;

    return {
        batteryCharge: charge,
        batteryCapacity: capacity,
        batteryVoltage: voltage,
        batteryVoltageRaw: voltageRaw,
        oiMode: resolveOiMode(roombaStatus.oiMode),
    };
}

function clearActiveCountdown() {
    if (emergencyState.countdownTimer) {
        clearTimeout(emergencyState.countdownTimer);
        emergencyState.countdownTimer = null;
    }
    if (emergencyState.tickInterval) {
        clearInterval(emergencyState.tickInterval);
        emergencyState.tickInterval = null;
    }
    emergencyState.active = false;
    emergencyState.startedAt = 0;
    emergencyState.initiatorId = null;
    emergencyState.initiatorNickname = '';
}

function scheduleIdleReset() {
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
    resetTimer = setTimeout(() => {
        if (emergencyState.active) {
            return;
        }
        lastOutcome = null;
        broadcastStatus();
    }, RESET_AFTER_RESULT_MS);
}

function currentRemainingMs() {
    if (!emergencyState.active) return 0;
    const deadline = emergencyState.startedAt + COUNTDOWN_DURATION_MS;
    return Math.max(0, deadline - Date.now());
}

function buildBaseStatus() {
    if (emergencyState.active) {
        return {
            state: 'countdown',
            initiatedAt: emergencyState.startedAt,
            initiator: {
                id: emergencyState.initiatorId,
                nickname: emergencyState.initiatorNickname,
            },
            totalMs: COUNTDOWN_DURATION_MS,
            remainingMs: currentRemainingMs(),
            outcome: null,
        };
    }

    if (lastOutcome) {
        return {
            state: lastOutcome.state,
            initiatedAt: lastOutcome.initiatedAt,
            initiator: lastOutcome.initiator,
            totalMs: COUNTDOWN_DURATION_MS,
            remainingMs: 0,
            outcome: lastOutcome,
        };
    }

    return {
        state: 'idle',
        initiatedAt: null,
        initiator: null,
        totalMs: COUNTDOWN_DURATION_MS,
        remainingMs: 0,
        outcome: null,
    };
}

function enrichStatusForSocket(baseStatus, socket) {
    const isInitiator = emergencyState.active && socket.id === emergencyState.initiatorId;
    const canCancel = emergencyState.active && (isInitiator || Boolean(socket.isAdmin));

    return {
        ...baseStatus,
        canCancel,
        initiatedByYou: isInitiator,
    };
}

function enrichStatusForSpectator(baseStatus) {
    return {
        ...baseStatus,
        canCancel: false,
        initiatedByYou: false,
    };
}

function broadcastStatus() {
    const baseStatus = buildBaseStatus();

    io.of('/').sockets.forEach((socket) => {
        socket.emit('emergency:status', enrichStatusForSocket(baseStatus, socket));
    });

    if (spectatorNamespace) {
        spectatorNamespace.sockets.forEach((socket) => {
            socket.emit('emergency:status', enrichStatusForSpectator(baseStatus));
        });
    }
}

function handleCountdownComplete() {
    if (!emergencyState.active) {
        return;
    }

    const initiatedAt = emergencyState.startedAt;
    const initiator = {
        id: emergencyState.initiatorId,
        nickname: emergencyState.initiatorNickname,
    };

    logger.warn(`Owner alert countdown elapsed; initiated by ${initiator.nickname} (${initiator.id})`);
    runAlert(initiator.nickname, roombaStatus.batteryCharge, roombaStatus.batteryCapacity, roombaStatus.oiMode);

    clearActiveCountdown();

    const executedAt = Date.now();
    lastOutcome = {
        state: 'executed',
        timestamp: executedAt,
        initiatedAt,
        initiator,
        actedBy: initiator,
        telemetry: buildTelemetrySnapshot(),
    };

    broadcastStatus();
    scheduleIdleReset();
}

function handleCancel(socket) {
    if (!emergencyState.active) {
        socket.emit('emergency:error', 'No active owner alert countdown to cancel.');
        return;
    }

    const isInitiator = socket.id === emergencyState.initiatorId;
    const isAdmin = Boolean(socket.isAdmin);

    if (!isInitiator && !isAdmin) {
        socket.emit('emergency:error', 'You are not allowed to cancel this owner alert countdown.');
        return;
    }

    const startedAt = emergencyState.startedAt;
    const initiator = {
        id: emergencyState.initiatorId,
        nickname: emergencyState.initiatorNickname,
    };

    logger.warn(`Owner alert countdown canceled by ${deriveNickname(socket)} (${socket.id})`);

    clearActiveCountdown();

    lastOutcome = {
        state: 'canceled',
        timestamp: Date.now(),
        initiatedAt: startedAt,
        initiator,
        actedBy: {
            id: socket.id,
            nickname: deriveNickname(socket),
            isAdmin,
        },
        telemetry: buildTelemetrySnapshot(),
    };

    broadcastStatus();
    scheduleIdleReset();
}

function handleInitiate(socket, payload = {}) {
    if (emergencyState.active) {
        socket.emit('emergency:error', 'An owner alert countdown is already running.');
        return;
    }

    if (typeof payload.phrase !== 'string' || payload.phrase.trim().toLowerCase() !== CONFIRMATION_PHRASE) {
        socket.emit('emergency:error', 'Confirmation phrase mismatch. Type "confirm" to proceed.');
        return;
    }

    const nickname = deriveNickname(socket);
    const now = Date.now();

    emergencyState.active = true;
    emergencyState.startedAt = now;
    emergencyState.initiatorId = socket.id;
    emergencyState.initiatorNickname = nickname;
    emergencyState.countdownTimer = setTimeout(handleCountdownComplete, COUNTDOWN_DURATION_MS);
    emergencyState.tickInterval = setInterval(broadcastStatus, 1000);

    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
    lastOutcome = null;

    logger.warn(`Owner alert countdown initiated by ${nickname} (${socket.id})`);

    broadcastStatus();
}

function attachSocketHandlers(socket) {
    socket.on('emergency:initiate', (payload) => handleInitiate(socket, payload));
    socket.on('emergency:cancel', () => handleCancel(socket));
    socket.on('disconnect', () => {
        // If the initiator disconnects, admins can still cancel; broadcasts keep everyone in sync.
        // We still rebroadcast to update per-socket permissions if needed.
        setImmediate(broadcastStatus);
    });

    setTimeout(() => {
        socket.emit(
            'emergency:status',
            socket.nsp?.name === '/spectate'
                ? enrichStatusForSpectator(buildBaseStatus())
                : enrichStatusForSocket(buildBaseStatus(), socket)
        );
    }, 0);
}

io.on('connection', (socket) => {
    attachSocketHandlers(socket);
});

if (spectatorNamespace) {
    spectatorNamespace.on('connection', (socket) => {
        attachSocketHandlers(socket);
    });
}

logger.info('Owner alert service initialized; awaiting triggers.');

module.exports = {
    COUNTDOWN_DURATION_MS,
};
