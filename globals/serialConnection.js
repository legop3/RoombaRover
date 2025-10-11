const { SerialPort } = require('serialport');
const config = require('../config');
const { createLogger } = require('../logger');

const logger = createLogger('SerialConnection');

const portPath = config.serial.port;
const baudRate = config.serial.baudrate;

const port = new SerialPort({ path: portPath, baudRate }, (err) => {
    if (err) {
        logger.error('Failed to open serial port', err);
        return;
    }
    logger.info('Serial port opened successfully');
});

function tryWrite(serialPort, command) {
    try {
        serialPort.write(Buffer.from(command));
    } catch (err) {
        logger.error('Error writing to serial port', err);
    }
}

module.exports = {
    port,
    tryWrite,
};
