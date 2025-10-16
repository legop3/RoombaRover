// const { getServer } = require('./ioContext');
const { state } = require('../services/accessControl');
const { driveDirect, auxMotorSpeeds } = require('../helpers/roombaCommands');
const { createLogger } = require('../helpers/logger');
const { io } = require('../globals/wsSocketExpress');

// const io = getServer();
const logger = createLogger('TurnHandler');

const TURN_DURATION_MS = 60_000;
const BROADCAST_INTERVAL_MS = 1_000;
const IDLE_GRACE_PERIOD_MS = 5_000;

// In-memory turn state: queue[0] is the active driver, the rest are waiting.
const queue = [];
let currentDriver = null;
let currentTurnExpiresAt = null;
let turnTimer = null;
let broadcastTimer = null;
let chargingPause = false;
let chargingPauseReason = null;
let idleSkipTimer = null;
let currentTurnStartedAt = null;
let currentIdleSkipExpiresAt = null;

function getNickname(socket) {
    if (!socket) return 'User';
    if (typeof socket.nickname === 'string' && socket.nickname.trim()) {
        return socket.nickname.trim().slice(0, 24);
    }
    const id = typeof socket.id === 'string' ? socket.id : '';
    return id.length >= 4 ? `User ${id.slice(-4)}` : 'User';
}

function cancelTurnTimer() {
    if (!turnTimer) return;
    clearTimeout(turnTimer);
    turnTimer = null;
}

function cancelIdleSkipTimer() {
    if (!idleSkipTimer) return;
    clearTimeout(idleSkipTimer);
    idleSkipTimer = null;
}

function resetIdleSkipTracking() {
    cancelIdleSkipTimer();
    currentTurnStartedAt = null;
    currentIdleSkipExpiresAt = null;
}

function hasDriverActivitySince(socket, sinceTimestamp) {
    if (!socket || typeof sinceTimestamp !== 'number') return false;
    const lastActivity = typeof socket.lastDriveCommandAt === 'number' ? socket.lastDriveCommandAt : 0;
    return lastActivity >= sinceTimestamp;
}

function refreshIdleSkipTracking() {
    if (!currentDriver || chargingPause || state.mode !== 'turns') {
        if (currentIdleSkipExpiresAt !== null || currentTurnStartedAt !== null) {
            resetIdleSkipTracking();
        }
        return;
    }

    if (!currentIdleSkipExpiresAt) return;

    if (hasDriverActivitySince(currentDriver, currentTurnStartedAt)) {
        cancelIdleSkipTimer();
        currentIdleSkipExpiresAt = null;
    }
}

function ensureBroadcasting() {
    if (broadcastTimer) return;
    broadcastTimer = setInterval(broadcastStatus, BROADCAST_INTERVAL_MS);
}

function stopBroadcasting() {
    if (!broadcastTimer) return;
    clearInterval(broadcastTimer);
    broadcastTimer = null;
}

// Remove stale sockets and keep timers in sync with actual connections.
function cleanupQueue() {
    for (let i = queue.length - 1; i >= 0; i--) {
        const socket = queue[i];
        if (!socket || !socket.connected || socket.isAdmin) {
            if (currentDriver && socket && currentDriver.id === socket.id) {
                currentDriver = null;
                currentTurnExpiresAt = null;
                cancelTurnTimer();
                resetIdleSkipTracking();
            }
            queue.splice(i, 1);
        }
    }
}

// Notify every client about the current turn state and timing.
function broadcastStatus() {
    cleanupQueue();
    refreshIdleSkipTracking();
    const mode = state.mode;
    const serverTimestamp = Date.now();
    const queueSnapshot = queue.map((socket, idx) => ({
        id: socket.id,
        nickname: getNickname(socket),
        isAdmin: socket.isAdmin,
        isCurrent: mode === 'turns' && !chargingPause && idx === 0 && socket.connected,
    }));

    io.emit('turns:update', {
        mode,
        isTurnModeActive: mode === 'turns',
        queue: queueSnapshot,
        currentDriverId: queueSnapshot.length && mode === 'turns' ? queueSnapshot[0].id : null,
        turnDurationMs: TURN_DURATION_MS,
        turnExpiresAt: mode === 'turns' ? currentTurnExpiresAt : null,
        idleSkipExpiresAt: mode === 'turns' ? currentIdleSkipExpiresAt : null,
        idleGracePeriodMs: IDLE_GRACE_PERIOD_MS,
        serverTimestamp,
        chargingPause,
        chargingPauseReason,
    });
}

// Reflect the driving right on each socket so other systems can check it.
function applyDrivingFlags() {
    queue.forEach((socket, idx) => {
        socket.driving = state.mode === 'turns' && !chargingPause && idx === 0;
    });
}

// Tear down timers and driving flags when turns mode is disabled.
function stopTurns() {
    cancelTurnTimer();
    resetIdleSkipTracking();
    stopBroadcasting();
    if (currentDriver && !currentDriver.isAdmin) {
        currentDriver.driving = false;
    }
    if (currentDriver) {
        logger.info(`Stopping turns; clearing current driver ${currentDriver.id}`);
    }
    currentDriver = null;
    currentTurnExpiresAt = null;
    chargingPause = false;
    chargingPauseReason = null;
    queue.forEach((socket) => {
        if (!socket.isAdmin) socket.driving = false;
    });
    broadcastStatus();
}

// Promote the next eligible socket to driver and start the turn timer.
function startCurrentDriver() {
    cleanupQueue();

    if (state.mode !== 'turns') {
        stopTurns();
        return;
    }

    if (chargingPause) {
        logger.info('Turns paused for charging; broadcasting status only');
        cancelTurnTimer();
        currentDriver = null;
        currentTurnExpiresAt = null;
        applyDrivingFlags();
        ensureBroadcasting();
        broadcastStatus();
        return;
    }

    if (queue.length === 0) {
        stopTurns();
        return;
    }

    const nextDriver = queue[0];

    if (!nextDriver || !nextDriver.connected) {
        logger.debug('Skipping disconnected queue entry during startCurrentDriver');
        queue.shift();
        startCurrentDriver();
        return;
    }

    if (currentDriver && currentDriver.id === nextDriver.id && turnTimer) {
        logger.debug(`Continuing current driver ${currentDriver.id}`);
        broadcastStatus();
        return;
    }

    if (currentDriver && currentDriver.id !== nextDriver.id && currentDriver.connected && !currentDriver.isAdmin) {
        logger.info(`Revoking previous driver ${currentDriver.id}`);
        currentDriver.driving = false;
    }

    if (!currentDriver || currentDriver.id !== nextDriver.id) {
        logger.info(`Switching driver to ${nextDriver.id}`);
        driveDirect(0, 0);
        auxMotorSpeeds(0, 0, 0);
    }

    currentDriver = nextDriver;
    applyDrivingFlags();

    cancelTurnTimer();
    cancelIdleSkipTimer();

    const now = Date.now();
    currentTurnStartedAt = now;
    currentTurnExpiresAt = now + TURN_DURATION_MS;
    turnTimer = setTimeout(() => {
        turnTimer = null;
        advanceTurn();
    }, TURN_DURATION_MS);

    if (!currentDriver.isAdmin) {
        currentIdleSkipExpiresAt = now + IDLE_GRACE_PERIOD_MS;
        const expectedDriverId = currentDriver.id;
        const expectedTurnStart = now;
        const driverSocket = currentDriver;

        idleSkipTimer = setTimeout(() => {
            idleSkipTimer = null;
            if (!currentDriver || currentDriver.id !== expectedDriverId) return;
            if (currentTurnStartedAt !== expectedTurnStart) return;
            if (chargingPause || state.mode !== 'turns') return;
            if (hasDriverActivitySince(driverSocket, expectedTurnStart)) {
                currentIdleSkipExpiresAt = null;
                broadcastStatus();
                return;
            }
            logger.info(`Skipping driver ${expectedDriverId} due to inactivity`);
            currentIdleSkipExpiresAt = null;
            try {
                driverSocket.emit('alert', 'Your turn was skipped because you did not move within 5 seconds.');
            } catch (error) {
                logger.debug('Failed to notify driver about idle skip', error);
            }
            advanceTurn();
        }, IDLE_GRACE_PERIOD_MS);
    } else {
        currentIdleSkipExpiresAt = null;
    }

    ensureBroadcasting();
    broadcastStatus();
}

// Rotate the queue after a turn expires or the driver leaves.
function advanceTurn() {
    if (queue.length === 0) {
        stopTurns();
        return;
    }

    const finished = queue.shift();
    if (finished) {
        finished.driving = false;
        if (finished.connected && !finished.isAdmin) {
            queue.push(finished);
        }
    }

    currentDriver = null;
    currentTurnExpiresAt = null;
    resetIdleSkipTracking();
    startCurrentDriver();
}

// Register a non-admin socket for turns and kick off the flow if needed.
function addSocketToQueue(socket) {
    if (!socket || socket.isAdmin) return;
    if (queue.find((entry) => entry.id === socket.id)) {
        logger.debug(`Socket ${socket.id} already queued`);
        broadcastStatus();
        return;
    }

    logger.info(`Adding socket ${socket.id} to turn queue`);
    queue.push(socket);

    if (state.mode === 'turns') {
        startCurrentDriver();
    } else {
        broadcastStatus();
    }
}

// Drop a socket from the queue and hand off the turn if it was driving.
function removeSocketFromQueue(socketId) {
    const index = queue.findIndex((entry) => entry.id === socketId);
    if (index === -1) return;

    const [removed] = queue.splice(index, 1);

    if (removed && removed.driving) {
        logger.info(`Removing current driver ${removed.id} from queue`);
        cancelTurnTimer();
        resetIdleSkipTracking();
        currentDriver = null;
        currentTurnExpiresAt = null;
        startCurrentDriver();
        return;
    }

    logger.debug(`Removed queued socket ${socketId}`);
    broadcastStatus();
}

// Pause the rotation, typically while the rover is charging.
function setChargingPause(reason = 'charging') {
    if (chargingPause && chargingPauseReason === reason) {
        logger.debug('Charging pause already active with identical reason');
        applyDrivingFlags();
        ensureBroadcasting();
        broadcastStatus();
        return;
    }

    chargingPause = true;
    chargingPauseReason = reason;
    logger.info(`Charging pause set | reason=${reason}`);
    cancelTurnTimer();
    resetIdleSkipTracking();
    if (currentDriver && !currentDriver.isAdmin) {
        logger.info(`Clearing driver ${currentDriver.id} due to charging pause`);
        currentDriver.driving = false;
    }
    currentDriver = null;
    currentTurnExpiresAt = null;

    try {
        driveDirect(0, 0);
        auxMotorSpeeds(0, 0, 0);
    } catch (error) {
        logger.error('Failed to halt motors during charging pause', error);
    }

    applyDrivingFlags();
    ensureBroadcasting();
    broadcastStatus();
}

// Resume normal turn rotation once charging completes.
function clearChargingPause() {
    if (!chargingPause) return;
    logger.info('Clearing charging pause');
    chargingPause = false;
    chargingPauseReason = null;
    startCurrentDriver();
}

// Rehydrate the queue based on currently connected sockets.
async function rebuildQueueFromActiveSockets() {
    try {
        const sockets = await io.fetchSockets();
        const knownIds = new Set(queue.map((socket) => socket.id));
        sockets.forEach((socket) => {
            if (!socket.isAdmin && !knownIds.has(socket.id)) {
                queue.push(socket);
            }
        });
        cleanupQueue();
    } catch (error) {
        logger.error('Failed to rebuild queue from active sockets', error);
    }
}

// Admin-only control surface: switch into or out of turn mode.
async function handleModeChange(newMode) {
    if (newMode === 'turns') {
        await rebuildQueueFromActiveSockets();
        startCurrentDriver();
        return;
    }

    stopTurns();
}

// Track each connection so we can put non-admins in the turn rotation.
io.on('connection', (socket) => {
    if (socket.isAdmin) {
        socket.on('change-access-mode', handleModeChange);
    } else {
        addSocketToQueue(socket);
        if (state.mode === 'turns') {
            socket.emit('alert', 'Turns mode is active. Please wait for your turn to drive.');
        }
    }

    socket.on('disconnect', () => {
        removeSocketFromQueue(socket.id);
    });

    socket.on('set-spectate-mode', spectate => {
        logger.info(`spectate mode ${spectate} for socket ${socket.id}`);

        if (spectate) {
            logger.info(`Removing socket ${socket.id} from turn queue due to spectate mode`);
            socket.driving = false;
            removeSocketFromQueue(socket.id);
            // applyDrivingFlags();

        } else {
            logger.info(`Adding socket ${socket.id} to turn queue due to spectate mode off`);
            addSocketToQueue(socket);
            applyDrivingFlags();
        }
    });
});

// Recover turn state on startup so we do not need a manual reset.
(async function bootstrap() {
    await rebuildQueueFromActiveSockets();
    if (state.mode === 'turns') {
        startCurrentDriver();
    } else {
        broadcastStatus();
    }
})();

module.exports = {
    setChargingPause,
    clearChargingPause,
    isChargingPauseActive: () => chargingPause,
    getChargingPauseReason: () => chargingPauseReason,
    forceBroadcast: broadcastStatus,
};
