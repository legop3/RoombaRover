const { getServer } = require('./ioContext');
const { findAdminByPassword } = require('./adminDirectory');
const { announceModeChange } = require('./discordBot');

const io = getServer();
let gmode = 'admin'; // default mode

console.log('Access Control Module Loaded');

io.use((socket, next) => {
    console.log('access contrl middleware running');

    const token = socket.handshake?.auth?.token || '';
    const adminProfile = findAdminByPassword(token);

    socket.isAdmin = Boolean(adminProfile);
    socket.adminProfile = adminProfile || null;
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
        }

        socket.driving = canDrive;

        if (previousDrivingState !== canDrive) {
            console.log(`socket ${socket.id} driving state updated: ${previousDrivingState} -> ${canDrive}`);
        }
    });
}

function disconnectAllSockets(reason) {
    const sockets = Array.from(io.of('/').sockets.values());

    if (!sockets.length) return;

    console.log(`Disconnecting ${sockets.length} sockets (${reason})`);

    sockets.forEach((socket) => {

        if(!socket.isAdmin) {
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
    } else {
        console.log('INVALID MODE');
    }
    console.log('MODE CHANGED TO', gmode);
    io.emit('admin-login', gmode);
    updateSocketModes(gmode);

    // announce change on bot to announcement channels
    announceModeChange(gmode)

    if (gmode === 'admin' || gmode === 'turns') {
        disconnectAllSockets(`mode switch to ${gmode}`);
    }
}

const accessControlState = {
    get mode() {
        return gmode;
    },
};

module.exports = { changeMode, state: accessControlState };
