// log-capture.js
let logOutput = [];
const originalWrite = process.stdout.write;

// Set up the capture immediately when this module is loaded
process.stdout.write = function(chunk, encoding, callback) {
    if (typeof chunk === 'string') {
        logOutput.push(chunk.trim());
    }
    // Still write to console
    return originalWrite.call(process.stdout, chunk, encoding, callback);
};

// Export functions to access the captured logs
module.exports = {
    getLogs: () => logOutput,
    clearLogs: () => { logOutput = []; },
    restoreConsole: () => { 
        process.stdout.write = originalWrite; 
    }
};