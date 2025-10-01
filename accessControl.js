const io = require('./server').io;
const config = require('./config');
const {isPublicMode} = require('./publicMode');

var mode = 'admin'; // default mode

console.log('Access Control Module Loaded');

io.on('connection', async (socket) => {
    console.log('Access Control Module: A user connected');
    console.log('Socket ID:', socket.id, 'isAdmin:', socket.isAdmin, 'authenticated:', socket.authenticated);
}); 

io.use((socket, next) => {
    const token = socket.handshake.auth.token

    if (token === config.accessControl.adminPassword) {
        socket.authenticated = true
        socket.isAdmin = true
        next()
    } else if (isPublicMode()) {
        socket.authenticated = true
        socket.isAdmin = false
        next()
    } else {
        socket.authenticated = true
        socket.isAdmin = false
        next()
    }



})


function changeMode(mode) {
    if (mode === 'admin') {

    } else if (mode === 'turns') {

    } else if (mode === 'open') {

    }
}

module.exports = {changeMode};