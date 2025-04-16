const { SerialPort } = require('serialport');

const portPath = '/dev/ttyACM0';
const baudRate = 115200;

const port = new SerialPort({ path: portPath, baudRate: baudRate }, (err) => {
    if (err) {
        return console.error('Error opening port:', err.message);
    }
    console.log('Serial port opened successfully');
});

port.on('open', () => {
    port.write(Buffer.from([128]));
    setTimeout(() => {
        port.write(Buffer.from([132]));
    }, 100);
});

function driveDirect(rightVelocity, leftVelocity) {
    rightVelocity = Math.max(-500, Math.min(500, rightVelocity));
    leftVelocity = Math.max(-500, Math.min(500, leftVelocity));
    const rightHigh = (rightVelocity >> 8) & 0xFF;
    const rightLow = rightVelocity & 0xFF;
    const leftHigh = (leftVelocity >> 8) & 0xFF;
    const leftLow = leftVelocity & 0xFF;
    const command = Buffer.from([145, rightHigh, rightLow, leftHigh, leftLow]);
    port.write(command);
}

function stop() {
    driveDirect(0, 0);
}

module.exports = {
    driveDirect,
    stop,
    port
};