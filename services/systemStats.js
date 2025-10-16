const os = require('os');
const { io } = require('../globals/wsSocketExpress');
const { createLogger } = require('../helpers/logger');

const logger = createLogger('SystemStats');
const EMIT_INTERVAL_MS = 5_000;

let lastCpuInfo = os.cpus();

function getCpuUsage() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (let i = 0; i < cpus.length; i++) {
        const current = cpus[i].times;
        const last = lastCpuInfo[i].times;
        const idleDiff = current.idle - last.idle;
        const totalDiff = (current.user - last.user)
            + (current.nice - last.nice)
            + (current.sys - last.sys)
            + (current.irq - last.irq)
            + idleDiff;
        idle += idleDiff;
        total += totalDiff;
    }

    lastCpuInfo = cpus;
    return total ? Math.round(100 - (idle / total) * 100) : 0;
}

function getMemoryUsage() {
    return Math.round(100 - (os.freemem() / os.totalmem()) * 100);
}

setInterval(() => {
    try {
        io.emit('system-stats', {
            cpu: getCpuUsage(),
            memory: getMemoryUsage(),
        });
    } catch (error) {
        logger.error('Failed to broadcast system stats', error);
    }
}, EMIT_INTERVAL_MS);

module.exports = {
    getCpuUsage,
    getMemoryUsage,
};
