const { port } = require('../globals/serialConnection');
const config = require('../helpers/config');
const { createLogger } = require('../helpers/logger');

const logger = createLogger('FTDIGPIO');

logger.info('FTDI Pulse module initialized');

const DTS_ON_TIME = 1000;
const DTS_OFF_TIME = 1 * 59 * 1000; // 59 seconds off


port.on('open', () => {
    logger.info('Serial port is open, starting pulse sequence');
    // setInterval(pulseRts, DTS_ON_TIME + DTS_OFF_TIME);
    startPulseRts();
});

function rtsHigh() {
    try {
        port.set({ rts: false });
        // logger.info('RTS set high');
    } catch (err) {
        logger.error('Error setting RTS high', err);
    }
}

function rtsLow() {
    try {
        port.set({ rts: true });
        // logger.info('RTS set low');
    } catch (err) {
        logger.error('Error setting RTS low', err);
    }
}

function startPulseRts() {
    rtsHigh();
    setTimeout(() => {
        rtsLow();
        setTimeout(startPulseRts, DTS_OFF_TIME);
    }, DTS_ON_TIME);
}