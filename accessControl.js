const io = require('./server').io;
const config = require('./config');
// const {isPublicMode} = require('./publicMode');

var gmode = 'open'; // default mode

console.log('Access Control Module Loaded');

io.on('connection', async (socket) => {
    console.log('Access Control Module: A user connected');
    console.log('Socket ID:', socket.id, 'isAdmin:', socket.isAdmin, 'authenticated:', socket.authenticated);
}); 

io.use((socket, next) => {
    console.log('access contrl middleware running')

    const token = socket.handshake.auth.token
    // let admins login always 
    if(token) {
        if(token === config.accessControl.adminPassword) {
            socket.isAdmin = true
            socket.driving = true
            next()
        } else {
            socket.isAdmin = false
        }
    } else {
        socket.isAdmin = false
    }

    // if in admin mode, kick off non-admins from connecting. give them an error.
    if(gmode === 'admin' && !socket.isAdmin) {
        console.log('kicking non-admin !!')
        next(new Error("Admin mode enabled"))
    }

    if(gmode === 'open') {
        socket.driving = true;
        next()
    }

    if(gmode === 'turns') {
        socket.driving = false;
        next()
    }

    console.log(`socket status after init, Admin: ${socket.isAdmin}, Driving: ${socket.driving}, Mode: ${gmode}`);
})


function changeMode(mode) {
    if (mode === 'admin') {

    } else if (mode === 'turns') {

    } else if (mode === 'open') {

    }
}

module.exports = {changeMode};