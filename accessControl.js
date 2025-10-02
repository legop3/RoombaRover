const config = require('./config');
// const {isPublicMode} = require('./publicMode');

let io;
let initialized = false;
let gmode = 'turns'; // default mode

console.log('Access Control Module Loaded');

function ensureInitialized() {
    if (!initialized) {
        throw new Error('Access control not initialized with socket.io instance');
    }
}

function init(ioInstance) {
    if (initialized) {
        return;
    }

    io = ioInstance;
    initialized = true;

    io.use((socket, next) => {
        console.log('access contrl middleware running');

        const token = socket.handshake?.auth?.token || '';

        socket.isAdmin = token === config.accessControl.adminPassword;
        socket.driving = socket.isAdmin; // admins can always drive

        if (gmode === 'admin' && !socket.isAdmin) {
            console.log('kicking non-admin !!');
            return next(new Error('Admin mode enabled'));
        }

        if (gmode === 'open') {
            socket.driving = true;
        } else if (gmode === 'turns') {
            socket.driving = false;
        }

        console.log(`socket status after init, Admin: ${socket.isAdmin}, Driving: ${socket.driving}, Mode: ${gmode}`);
        return next();
    });

    io.on('connection', async (socket) => {
        console.log('Access Control Module: A user connected');
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
}

function updateSocketModes(mode) {
    ensureInitialized();
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
        }

        socket.driving = canDrive;

        if (previousDrivingState !== canDrive) {
            console.log(`socket ${socket.id} driving state updated: ${previousDrivingState} -> ${canDrive}`);
        }
    });
}

function changeMode(mode) {
    ensureInitialized();

    if (mode === 'admin') {
        gmode = 'admin';
    } else if (mode === 'turns') {
        gmode = 'turns';
    } else if (mode === 'open') {
        gmode = 'open';
    } else {
        console.log('INVALID MODE');
    }
    console.log('MODE CHANGED TO', gmode);
    io.emit('admin-login', gmode);
    updateSocketModes(gmode);
}

const accessControlState = {
    get mode() {
        return gmode;
    },
};

module.exports = { init, changeMode, state: accessControlState };
