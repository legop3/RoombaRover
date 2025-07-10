const EventEmitter = require('events');

let logOutput = [];
const originalWrite = process.stdout.write;
const emitter = new EventEmitter();

process.stdout.write = function(chunk, encoding, callback) {
    if (typeof chunk === 'string') {
        logOutput.push(chunk.trim());
    }
    // still write to console

    emitter.emit('logEvent', {
        // message: chunk.trim(),
        // timestamp: new Date().toISOString(),
        // index: logOutput.length - 1
    })

    if (logOutput.length > 500) {
        logOutput.shift(); // Keep the log size manageable
    }

    return originalWrite.call(process.stdout, chunk, encoding, callback);
};

module.exports = {
    getLogs: () => logOutput,
    clearLogs: () => { logOutput = []; },
    restoreConsole: () => { 
        process.stdout.write = originalWrite; 
    },
    on: (event, listener) => {emitter.on(event, listener)}
};