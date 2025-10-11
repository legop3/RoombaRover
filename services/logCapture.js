// const EventEmitter = require('events');
const { io } = require('../globals/wsSocketExpress')

let logOutput = [];
const originalWrite = process.stdout.write;
// const emitter = new EventEmitter();

process.stdout.write = function(chunk, encoding, callback) {
    if (typeof chunk === 'string') {
        logOutput.push(chunk.trim());
    }
    // still write to console

    // emitter.emit('logEvent', {
        // message: chunk.trim(),
        // timestamp: new Date().toISOString(),
        // index: logOutput.length - 1
    // })
    io.emit('logs', logOutput);

    if (logOutput.length > 50) {
        logOutput.shift(); // Keep the log size manageable
    }

    return originalWrite.call(process.stdout, chunk, encoding, callback);
};

io.on('connection', (socket) => {
    socket.emit('logs', logOutput);

    socket.on('requestLogs', () => {
        socket.emit('logs', logOutput);
    })

    socket.on('resetLogs', () => {
        logOutput = [];
        logger.info('Log buffer reset on request');
        socket.emit('logs', 'Logs cleared.');
    })
})

module.exports = {
    getLogs: () => logOutput,
    clearLogs: () => { logOutput = []; },
    restoreConsole: () => { 
        process.stdout.write = originalWrite; 
    },
    // on: (event, listener) => {emitter.on(event, listener)}
};