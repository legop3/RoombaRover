const { SerialPort } = require('serialport'); 

//web stuff imports
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const { spawn } = require('child_process');





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
    console.log('Port is open. Ready to go...');

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
    // console.log('Received data:', data.toString());
    console.log('Raw data:', data);

    try {

        chargeStatus = data[0];
        // console.log('Charge status:', chargeStatus);
        batteryCharge = data.readInt16BE(1);
        // console.log('Battery charge:', batteryCharge);
        batteryCapacity = data.readInt16BE(3);
        // console.log('Battery capacity:', batteryCapacity);
        chargingSources = data[5];
        // console.log('Charging sources:', chargingSources);
        oiMode = data[6];
        // console.log('OI mode:', oiMode);


        io.emit('SensorData', {
            chargeStatus: chargeStatus,
            batteryCharge: batteryCharge,
            batteryCapacity: batteryCapacity,
            chargingSources: chargingSources,
            oiMode: oiMode
        }); // Emit the parsed data to all connected clients

    } catch (err) {
        console.error('Error parsing data:', err.message);
        return;
    }
    

    

    
        
    


});


port.on('error', (err) => {
    console.error('Serial port error:', err.message);
});





// socket listening stuff
io.on('connection', (socket) => {
    console.log('a user connected')

    // handle wheel speed commands
    socket.on('Speedchange', (data) => {
        console.log(data)
        driveDirect(data.rightSpeed, data.leftSpeed);
    });

    // stop driving on socket disconnect
    socket.on('disconnect', () => {
        console.log('user disconnected')
        driveDirect(0, 0);
    });

    // handle docking and reinit commands
    socket.on('Docking', (data) => {
        if (data.action == 'dock') {
            tryWrite(port, [143]); // Dock command
        }

        if (data.action == 'reconnect') {
            tryWrite(port, [128]); 
            tryWrite(port, [132]); 
        }
    })

    socket.on('SensorData', (data) => {
        // console.log('Sensor data request:', data);
        if (data.action == 'get') {
            console.log('getting sensor data')
            tryWrite(port, [149, 5, 21, 25, 26, 34, 35]); // query charging, battery charge, battery capacity, charging sources, OI mode
        }

        // if (data.action == 'stop') {
        //     console.log('stopping sensor data')
        //     tryWrite(port, [150, 0]); // stop sensor stream
        // }
    })

    // MJPEG webcam streaming
    let ffmpeg;
    let streaming = false;

    socket.on('startVideo', () => {
        if (streaming) return;
        streaming = true;
        // Adjust /dev/video0 if your webcam uses a different device
        ffmpeg = spawn('ffmpeg', [
            '-f', 'v4l2',
            '-framerate', '10',
            '-video_size', '640x480',
            '-i', '/dev/video0',
            '-f', 'mjpeg',
            '-q:v', '5',
            'pipe:1'
        ]);

        let frameBuffer = Buffer.alloc(0);

        ffmpeg.stdout.on('data', (chunk) => {
            frameBuffer = Buffer.concat([frameBuffer, chunk]);
            // MJPEG frames start with 0xFFD8 and end with 0xFFD9
            let start, end;
            while ((start = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]))) !== -1 &&
                   (end = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start)) !== -1) {
                let frame = frameBuffer.slice(start, end + 2);
                socket.emit('videoFrame', frame.toString('base64'));
                frameBuffer = frameBuffer.slice(end + 2);
            }
        });

        ffmpeg.stderr.on('data', (data) => {
            // Uncomment for debugging: console.error('ffmpeg stderr:', data.toString());
        });

        ffmpeg.on('close', () => {
            streaming = false;
        });
    });

    socket.on('stopVideo', () => {
        if (ffmpeg) {
            ffmpeg.kill('SIGINT');
            ffmpeg = null;
            streaming = false;
        }
    });

})
// charging state packet id 21, 0 means not charging
// battery charge packet id 25
// battery capacity packet id 26







// express stuff
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

server.listen(webport, () => {
    console.log(`Web server is running on http://localhost:${webport}`);
});

