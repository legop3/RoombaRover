const { SerialPort } = require('serialport');
const config = require('./config');
const { createLogger } = require('./logger');

const logger = createLogger('SerialPort');

const portPath = config.serial.port;  // Replace with your actual port
const baudRate = config.serial.baudrate;            // Replace with your desired baud rate

const port = new SerialPort({ path: portPath, baudRate: baudRate }, (err) => {
    if (err) {
        logger.error('Failed to open serial port', err);
        return;
    }
    logger.info('Serial port opened successfully');
});

function tryWrite(port, command) {

    try {
        port.write(Buffer.from(command));
        // console.log('Command written to port:', command);
    }
    catch (err) {
        logger.error('Error writing to serial port', err);
    }
}


module.exports = { 
    port,
    tryWrite,
}
