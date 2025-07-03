const { SerialPort } = require('serialport');
const config = require('./config.json');

const portPath = config.serial.port;  // Replace with your actual port
const baudRate = config.serial.baudrate;            // Replace with your desired baud rate

const port = new SerialPort({ path: portPath, baudRate: baudRate }, (err) => {
    if (err) {
        return console.error('Error opening port:', err.message);
    }
    console.log('Serial port opened successfully');
});

function tryWrite(port, command) {

    try {
        port.write(Buffer.from(command));
        // console.log('Command written to port:', command);
    }
    catch (err) {
        console.error('Error writing to port:', err.message);
    }
}


module.exports = { 
    port,
    tryWrite,
}
