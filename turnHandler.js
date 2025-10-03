const { getServer } = require('./ioContext');
const { state } = require('./accessControl');

const io = getServer();

const TURN_DURATION_MS = 45_000;
const BROADCAST_INTERVAL_MS = 1_000;

const queue = [];
let currentDriver = null;
let currentTurnExpiresAt = null;
let turnTimer = null;
let broadcastTimer = null;

function cancelTurnTimer() {
    if (!turnTimer) return;
    clearTimeout(turnTimer);
    turnTimer = null;
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

function cleanupQueue() {
    for (let i = queue.length - 1; i >= 0; i--) {
        const socket = queue[i];
        if (!socket || !socket.connected || socket.isAdmin) {
            if (currentDriver && socket && currentDriver.id === socket.id) {
                currentDriver = null;
                currentTurnExpiresAt = null;
                cancelTurnTimer();
            }
            queue.splice(i, 1);
        }
    }
}

function broadcastStatus() {
    cleanupQueue();
    const mode = state.mode;
    const serverTimestamp = Date.now();
    const queueSnapshot = queue.map((socket, idx) => ({
        id: socket.id,
        isAdmin: socket.isAdmin,
        isCurrent: mode === 'turns' && idx === 0 && socket.connected,
    }));

    io.emit('turns:update', {
        mode,
        isTurnModeActive: mode === 'turns',
        queue: queueSnapshot,
        currentDriverId: queueSnapshot.length && mode === 'turns' ? queueSnapshot[0].id : null,
        turnDurationMs: TURN_DURATION_MS,
        turnExpiresAt: mode === 'turns' ? currentTurnExpiresAt : null,
        serverTimestamp,
    });
}

function applyDrivingFlags() {
    queue.forEach((socket, idx) => {
        socket.driving = state.mode === 'turns' && idx === 0;
    });
}

function stopTurns() {
    cancelTurnTimer();
    stopBroadcasting();
    if (currentDriver && !currentDriver.isAdmin) {
        currentDriver.driving = false;
    }
    currentDriver = null;
    currentTurnExpiresAt = null;
    queue.forEach((socket) => {
        if (!socket.isAdmin) socket.driving = false;
    });
    broadcastStatus();
}

function startCurrentDriver() {
    cleanupQueue();

    if (state.mode !== 'turns') {
        stopTurns();
        return;
    }

    if (queue.length === 0) {
        stopTurns();
        return;
    }

    const nextDriver = queue[0];

    if (!nextDriver || !nextDriver.connected) {
        queue.shift();
        startCurrentDriver();
        return;
    }

    if (currentDriver && currentDriver.id === nextDriver.id && turnTimer) {
        broadcastStatus();
        return;
    }

    if (currentDriver && currentDriver.id !== nextDriver.id && currentDriver.connected && !currentDriver.isAdmin) {
        currentDriver.driving = false;
    }

    currentDriver = nextDriver;
    applyDrivingFlags();

    cancelTurnTimer();
    currentTurnExpiresAt = Date.now() + TURN_DURATION_MS;
    turnTimer = setTimeout(() => {
        turnTimer = null;
        advanceTurn();
    }, TURN_DURATION_MS);

    ensureBroadcasting();
    broadcastStatus();
}

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
    startCurrentDriver();
}

function addSocketToQueue(socket) {
    if (!socket || socket.isAdmin) return;
    if (queue.find((entry) => entry.id === socket.id)) {
        broadcastStatus();
        return;
    }

    queue.push(socket);

    if (state.mode === 'turns') {
        startCurrentDriver();
    } else {
        broadcastStatus();
    }
}

function removeSocketFromQueue(socketId) {
    const index = queue.findIndex((entry) => entry.id === socketId);
    if (index === -1) return;

    const [removed] = queue.splice(index, 1);

    if (removed && removed.driving) {
        cancelTurnTimer();
        currentDriver = null;
        currentTurnExpiresAt = null;
        startCurrentDriver();
        return;
    }

    broadcastStatus();
}

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
        console.error('turnHandler: failed to rebuild queue', error);
    }
}

async function handleModeChange(newMode) {
    if (newMode === 'turns') {
        await rebuildQueueFromActiveSockets();
        startCurrentDriver();
        return;
    }

    stopTurns();
}

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
});

(async function bootstrap() {
    await rebuildQueueFromActiveSockets();
    if (state.mode === 'turns') {
        startCurrentDriver();
    } else {
        broadcastStatus();
    }
})();
