const { SerialPort } = require('serialport');
const config = require('../helpers/config');
const { createLogger } = require('../helpers/logger');
const { alertAdmins } = require('../services/discordBot');

const logger = createLogger('SerialConnection');

const portPath = config.serial.port;
const baudRate = config.serial.baudrate;

const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const CLOSE_ALERT_THROTTLE_MS = 5 * 60_000;

let reconnectTimer = null;
let reconnectAttempts = 0;
let lastCloseAlertAt = 0;

const port = new SerialPort({ path: portPath, baudRate }, (err) => {
    if (err) {
        logger.error('Failed to open serial port', err);
        scheduleReconnect('initial-open-error');
        return;
    }
    logger.info('Serial port opened successfully');
});

port.on('close', (disconnectError) => {
    const reason = disconnectError?.message || 'Port closed';
    logger.error(`Serial port closed: ${reason}`);
    notifyAdmins(reason);
    scheduleReconnect('close');
});

port.on('error', (err) => {
    logger.error('Serial port error', err);
    if (err?.disconnected || err?.message === 'Port is not open') {
        scheduleReconnect('error');
    }
});

port.on('open', () => {
    reconnectAttempts = 0;
    clearReconnectTimer();
});

function notifyAdmins(reason) {
    const now = Date.now();
    if (now - lastCloseAlertAt < CLOSE_ALERT_THROTTLE_MS) {
        return;
    }
    lastCloseAlertAt = now;

    if (!config.discordBot?.enabled || typeof alertAdmins !== 'function') {
        return;
    }

    const message = `[Roomba Rover] Serial port ${portPath} closed (${reason}). Attempting automatic recovery.`;
    Promise.resolve(alertAdmins(message)).catch((error) => {
        logger.error('Failed to send serial port close alert to Discord admins', error);
    });
}

function clearReconnectTimer() {
    if (!reconnectTimer) {
        return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function scheduleReconnect(trigger) {
    if (port.isOpen || port.opening || reconnectTimer) {
        return;
    }

    const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * (2 ** reconnectAttempts),
        RECONNECT_MAX_DELAY_MS,
    );

    reconnectAttempts += 1;

    logger.warn(`Scheduling serial port reopen in ${delay}ms (trigger=${trigger}, attempt=${reconnectAttempts})`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;

        if (port.isOpen || port.opening) {
            reconnectAttempts = 0;
            return;
        }

        logger.info('Attempting to reopen serial port');

        port.open((err) => {
            if (err) {
                logger.error('Failed to reopen serial port', err);
                scheduleReconnect('retry');
                return;
            }

            logger.info('Serial port reopened successfully');
            reconnectAttempts = 0;
        });
    }, delay);
}

function tryWrite(serialPort, command) {
    if (!serialPort) {
        logger.warn('Serial port reference is unavailable; dropping command');
        return;
    }

    if (!serialPort.isOpen) {
        if (serialPort.opening) {
            logger.debug('Serial port is opening; queuing command for later transmission');
        } else {
            logger.warn('Attempted to write to serial port while it is closed; dropping command');
            return;
        }
    }

    try {
        serialPort.write(Buffer.from(command), (err) => {
            if (err) {
                logger.error('Error writing to serial port', err);
            }
        });
    } catch (err) {
        logger.error('Error writing to serial port', err);
    }
}

module.exports = {
    port,
    tryWrite,
};
