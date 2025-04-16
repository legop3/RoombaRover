const { SerialPort } = require('serialport'); 

//web stuff imports
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);





// configs
const webport = 3000
const portPath = '/dev/ttyACM0'; // Update this to match your system
const baudRate = 115200; 


// serial stuffs
// serial port manager
function portManager() {
    let port;

    return function(action) {
        if (action === 'open') {
            if (port && port.isOpen) {
                console.log('Port is already open.');
                return;
            }
            port = new SerialPort({ path: portPath, baudRate: baudRate }, (err) => {
                if (err) {
                    return console.error('Error opening port:', err.message);
                }
                console.log('Serial port opened successfully');
            });
        } else if (action === 'close') {
            if (port && port.isOpen) {
                port.close((err) => {
                    if (err) {
                        return console.error('Error closing port:', err.message);
                    }
                    console.log('Serial port closed successfully');
                });
            } else {
                console.log('Port is not open.');
            }
        } else {
            console.log('Invalid action. Use "open" or "close".');
        }
    };
}

// serial port try write
function tryWrite(port, command) {

    try {
        port.write(Buffer.from(command));
    }
    catch (err) {
        console.error('Error writing to port:', err.message);
    }
}




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

    try {
        port.write(command);
    } catch (err) {
        console.error('Error writing to port:', err.message);
    }
}





// temporary....?
port.on('open', () => {
    console.log('Port is open. Sending commands to Roomba...');

    // port.write(Buffer.from([128])); // Start command
    // port.write(Buffer.from([132])); // Safe mode command

    // // Wait a moment before sending drive command
    // setTimeout(() => {
    //     driveDirect(50, 50); // Both wheels forward at 200 mm/s
    // }, 500);

    // setTimeout(() => {
    //     port.write(Buffer.from([173])) // oi off
    // }, 2000);

    // setTimeout(() => {
    //     port.write(Buffer.from([143])) // dock
    // }, 5000)
});

port.on('data', (data) => {
    console.log('Received data:', data.toString());
});


port.on('error', (err) => {
    console.error('Serial port error:', err.message);
});





// socketio stuff
io.on('connection', (socket) => {
    console.log('a user connected')
    socket.on('Speedchange', (data) => {
        console.log(data)
        driveDirect(data.rightSpeed, data.leftSpeed);
    });

    socket.on('Docking', (data) => {
        if (data.action == 'dock') {
            tryWrite(port, [143]); // Dock command
        }

        if (data.action == 'reconnect') {
            tryWrite(port, [128]); 
            tryWrite(port, [132]); 
        }
    })
})



// express stuff
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

server.listen(webport, () => {
    console.log(`Web server is running on http://localhost:${webport}`);
});

