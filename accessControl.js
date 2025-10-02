const io = require('./server').io;
const config = require('./config');
// const {isPublicMode} = require('./publicMode');

var gmode = 'admin'; // default mode

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
            next()
        }
    }

    // if in admin mode, kick off non-admins from connecting. give them an error.
    if(gmode === 'admin' && !socket.isAdmin) {
        console.log('kicking non-admin !!')
        next(new Error("Admin mode enabled"))
    }


    // if (gmode === 'admin') {
    //     const token = socket.handshake.auth.token
    //     console.log('token: ', token)

    //     if (token === config.accessControl.adminPassword) {
    //         console.log('admin logged in');
    //         socket.driving = true
    //         socket.isAdmin = true
    //         next()
    //     } else {
    //         console.log('non-admin kicked, in admin mode.')
    //         // socket.emit('alert', 'Please log in with the admin password');
    //         // socket.emit('auth-init');
    //         next(new Error("Admin Mode Enabled"));
    //     }
    // }

    // if (gmode === 'public') {

    // }
    // const token = socket.handshake.auth.token

    // if (token === config.accessControl.adminPassword) {
    //     socket.driving = true
    //     socket.isAdmin = true
    //     next()
    // } else if (isPublicMode()) {
    //     socket.authenticated = true
    //     socket.isAdmin = false
    //     next()
    // } else {
    //     socket.authenticated = true
    //     socket.isAdmin = false
    //     next()
    // }
    // next()


})


function changeMode(mode) {
    if (mode === 'admin') {

    } else if (mode === 'turns') {

    } else if (mode === 'open') {

    }
}

module.exports = {changeMode};