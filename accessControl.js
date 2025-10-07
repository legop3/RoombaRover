const { getServer } = require('./ioContext');
const { findAdminByPassword } = require('./adminDirectory');
const { announceModeChange } = require('./discordBot');
const { createLogger } = require('./logger');

const logger = createLogger('AccessControl');

const io = getServer();
let gmode = 'admin'; // default mode

// Track which non-admin client key is currently associated with a live socket.
// This enforces one active browser tab per person without relying on IP
// addresses, which can be masked or shared by a reverse proxy.
const activeClientSessions = new Map();

function extractClientKey(socket) {
    const rawKey = socket.handshake?.auth?.clientKey;
    if (typeof rawKey !== 'string') {
        return '';
    }
    const trimmed = rawKey.trim();
    return trimmed ? trimmed.slice(0, 128) : '';
}

function claimClientSession(socket, sessionKey) {
    if (!sessionKey) return;

        const existingSocket = activeClientSessions.get(sessionKey);
        if (existingSocket && existingSocket.id !== socket.id) {
            const keyPreview = sessionKey.slice(0, 8);
            logger.warn(`Disconnecting duplicate client session for key ${keyPreview}`);
            existingSocket.emit('alert', 'You were disconnected because the Rover tab was opened somewhere else.');
            existingSocket.disconnect(true);
        }

    activeClientSessions.set(sessionKey, socket);

    socket.once('disconnect', () => {
        if (activeClientSessions.get(sessionKey) === socket) {
            activeClientSessions.delete(sessionKey);
        }
    });
}

logger.info('Module initialised');

io.use((socket, next) => {
    logger.debug('Authorising incoming socket connection');

    const token = socket.handshake?.auth?.token || '';
    const adminProfile = findAdminByPassword(token);

    socket.isAdmin = Boolean(adminProfile);
    socket.adminProfile = adminProfile || null;
    socket.driving = socket.isAdmin; // admins can always drive
    socket.lockdownBypass = socket.isAdmin && Boolean(adminProfile?.lockdown);

    logger.info(`Socket ${socket.id} authentication: admin=${socket.isAdmin} lockdownBypass=${socket.lockdownBypass}`);

    const clientKey = extractClientKey(socket);
    socket.clientKey = clientKey;

    if(gmode === 'lockdown') {
        logger.info(`Lockdown mode active while socket connecting ${socket.id}`);
        // if socket is in spectator namespace, error them
        if(socket.nsp.name === '/spectate') {
            logger.warn(`Rejecting spectator connection ${socket.id} while lockdown active`);
            return next(new Error('LOCKDOWN_ENABLED'));
        }

        if(!socket.lockdownBypass) {
            logger.warn(`Rejecting connection ${socket.id} while lockdown active`);
            return next(new Error('LOCKDOWN_ENABLED'));
        } else {
            logger.info(`Allowing admin connection ${socket.id} with lockdown bypass`);
        }
    }

    if (!socket.isAdmin) {
        if (clientKey) {
            claimClientSession(socket, clientKey);
        } else {
            logger.debug(`Non-admin socket ${socket.id} missing client key; skipping single-session enforcement`);
        }
    } else {
        socket.emit('admin-login')
        socket.emit('mode-update', gmode);
    }

    if (gmode === 'admin' && !socket.isAdmin) {
        logger.warn(`Rejecting non-admin connection ${socket.id} while admin mode active`);
        return next(new Error('ADMIN_ENABLED'));
    }

    if (gmode === 'open') {
        socket.driving = true;
    } else if (gmode === 'turns') {
        socket.driving = false;
    }



    logger.debug(`Socket ${socket.id} initialised | admin=${socket.isAdmin} driving=${socket.driving} mode=${gmode}`);
    return next();
});

io.on('connection', async (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);
    // console.log('Socket ID:', socket.id, 'isAdmin:', socket.isAdmin, 'authenticated:', socket.authenticated);
});

io.on('connection', async (socket) => {
    // console.log('SOCKET CONNECTION FROM')
    if (!socket.isAdmin) return;
    socket.on('change-access-mode', (data) => {
        // console.log('new access mode ', data)
        changeMode(data);
    });
});

function updateSocketModes(mode) {
    const sockets = io.of('/').sockets;

    sockets.forEach((socket) => {
        const previousDrivingState = socket.driving;

        let canDrive = socket.isAdmin;

        if (mode === 'open') {
            canDrive = true;
        } else if (mode === 'turns') {
            canDrive = false;
        } else if (mode === 'admin') {
            canDrive = socket.isAdmin;
        } else if (mode === 'lockdown') {
            canDrive = false
        }

        socket.driving = canDrive;

        if (previousDrivingState !== canDrive) {
            logger.debug(`Socket ${socket.id} driving state updated: ${previousDrivingState} -> ${canDrive}`);
        }
    });
}

function disconnectAllSockets(reason) {
    const sockets = Array.from(io.of('/').sockets.values());
    if (!sockets.length) return;
    logger.info(`Disconnecting ${sockets.length} sockets (${reason})`);
    sockets.forEach((socket) => {

        if(!socket.isAdmin) {
            // if(reason === 'SWITCH_TO_ADMIN') {
            //     socket.emit('disconnect-reason', reason);
            // }
            
            socket.emit('disconnect-reason', reason)

            logger.info(`reason for disconnecting: ${reason}`)
            socket.disconnect(true);
        }

        logger.info(`Filtering disconnects.. Lockdown bypass: ${socket.lockdownBypass}, reason: ${reason}`)
        if(!socket.lockdownBypass && reason === 'SWITCH_TO_LOCKDOWN') {

            socket.emit('disconnect-reason', reason)
            socket.disconnect(true);
        }
    });
}

function disconnectAllSpectators(reason) {
    const sockets = Array.from(io.of('/spectate').sockets.values());
    if (!sockets.length) return;
    logger.info(`Disconnecting ${sockets.length} spectator sockets (${reason})`);
    sockets.forEach((socket) => {

        if(reason === 'SWITCH_TO_LOCKDOWN') {
            socket.emit('disconnect-reason', reason)
            socket.disconnect(true);
        }
        
    });
}

function changeMode(mode) {
    if (mode === 'admin') {
        gmode = 'admin';
    } else if (mode === 'turns') {
        gmode = 'turns';
    } else if (mode === 'open') {
        gmode = 'open';
    } else if (mode === 'lockdown') {
        gmode = 'lockdown';
    } else {
        logger.warn(`Invalid mode requested: ${mode}`);
    }
    logger.info(`Mode updated to ${gmode}`);
    io.emit('mode-update', gmode);
    updateSocketModes(gmode);

    // announce change on bot to announcement channels
    announceModeChange(gmode)

    if (gmode === 'admin' || gmode === 'turns' || gmode === 'lockdown') {
        disconnectAllSockets(`SWITCH_TO_${gmode.toUpperCase()}`);
        disconnectAllSpectators(`SWITCH_TO_${gmode.toUpperCase()}`);
    }
}

const accessControlState = {
    get mode() {
        return gmode;
    },
};

module.exports = { changeMode, state: accessControlState };
