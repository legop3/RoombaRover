const { SerialPort } = require('serialport'); // Correct import for SerialPort


const portPath = '/dev/ttyACM0'; // Update this to match your system
const baudRate = 115200; // Default baud rate for Roomba Create 2

const port = new SerialPort({ path: portPath, baudRate: baudRate }, (err) => {
    if (err) {
        return console.error('Error opening port:', err.message);
    }
    console.log('Serial port opened successfully');
});


/**
 * Sends the Drive Direct command to the Roomba.
 * @param {number} rightVelocity - Right wheel velocity (-500 to 500 mm/s)
 * @param {number} leftVelocity - Left wheel velocity (-500 to 500 mm/s)
 */
function driveDirect(rightVelocity, leftVelocity) {
    // Clamp velocities to valid range
    rightVelocity = Math.max(-500, Math.min(500, rightVelocity));
    leftVelocity = Math.max(-500, Math.min(500, leftVelocity));

    // Convert to 16-bit signed integers (big-endian)
    const rightHigh = (rightVelocity >> 8) & 0xFF;
    const rightLow = rightVelocity & 0xFF;
    const leftHigh = (leftVelocity >> 8) & 0xFF;
    const leftLow = leftVelocity & 0xFF;

    const command = Buffer.from([145, rightHigh, rightLow, leftHigh, leftLow]);
    port.write(command);
}

// Open the port and send initial commands to the Roomba
port.on('open', () => {
    console.log('Port is open. Sending commands to Roomba...');

    port.write(Buffer.from([128])); // Start command
    port.write(Buffer.from([132])); // Safe mode command

    // Wait a moment before sending drive command
    setTimeout(() => {
        driveDirect(50, 50); // Both wheels forward at 200 mm/s
    }, 500);

    setTimeout(() => {
        port.write(Buffer.from([173]))
    }, 2000);
});

port.on('data', (data) => {
    console.log('Received data:', data.toString());
});

// Handle errors
port.on('error', (err) => {
    console.error('Serial port error:', err.message);
});