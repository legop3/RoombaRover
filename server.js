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
        // console.log('Command written to port:', command);
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
    // console.log('Raw data:', data);

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
        batteryVoltage = data.readInt16BE(7);
        // console.log('Battery voltage:', batteryVoltage);


        io.emit('SensorData', {
            chargeStatus: chargeStatus,
            batteryCharge: batteryCharge,
            batteryCapacity: batteryCapacity,
            chargingSources: chargingSources,
            oiMode: oiMode,
            batteryVoltage: batteryVoltage


        }); // Emit the parsed data to all connected clients

    } catch (err) {
        // console.error('Error parsing data:', err.message);
        return;
    }
    

    

    
        
    


});


port.on('error', (err) => {
    console.error('Serial port error:', err.message);
});





// MJPEG webcam streaming (shared for all clients)
let ffmpeg = null;
let streaming = false;
let sendFrameInterval = null;
let latestFrame = null;
let clientsWatching = 0;

function startGlobalVideoStream() {
    if (streaming) return;
    streaming = true;
    console.log('Starting video stream...');
    ffmpeg = spawn('ffmpeg', [
        '-f', 'v4l2',
        '-flags', 'low_delay',
        '-fflags', 'nobuffer',
        '-i', '/dev/video0',
        '-vf', 'scale=320:240',
        '-r', '30',
        '-q:v', '10',
        '-preset', 'ultrafast',
        '-an',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        'pipe:1',
    ]);

    let frameBuffer = Buffer.alloc(0);

    ffmpeg.stdout.on('data', (chunk) => {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
        let start, end;
        while ((start = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]))) !== -1 &&
               (end = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start)) !== -1) {
            let frame = frameBuffer.slice(start, end + 2);
            frameBuffer = frameBuffer.slice(end + 2);

            // Always update to the latest frame
            latestFrame = frame;
        }
    });

    sendFrameInterval = setInterval(() => {
        if (latestFrame) {
            const frameToSend = latestFrame;
            latestFrame = null;
            io.emit('videoFrame', frameToSend.toString('base64'));
        }
    }, 33); // ~15 fps

    ffmpeg.stderr.on('data', (data) => {
        // console.error('ffmpeg:', data.toString());
        io.emit('ffmpeg', data.toString());
    });

    ffmpeg.on('close', () => {
        streaming = false;
        latestFrame = null;
        ffmpeg = null;
        if (sendFrameInterval) {
            clearInterval(sendFrameInterval);
            sendFrameInterval = null;
        }
        console.log('ffmpeg process closed');
        io.emit('message', 'Video stream stopped');
    });
}

function stopGlobalVideoStream() {
    if (ffmpeg) {
        ffmpeg.kill('SIGTERM');
        ffmpeg = null;
        streaming = false;
        latestFrame = null;
        if (sendFrameInterval) {
            clearInterval(sendFrameInterval);
            sendFrameInterval = null;
        }
    }
}


// audio streaming stuff
let audiostreaming = false
let audio = null
function startAudioStream() {
    if (audiostreaming) return;
    audiostreaming = true;
    console.log('Starting audio stream...');
    audio = spawn('arecord', [
        '-D', 'plughw:2,0',
        '-f', 'S16_LE',
        '-r', '16000',
        '-c', '1',
        '--buffer-time=20000', // buffer time in microseconds (20ms)
        '--period-time=20000'  // period time in microseconds (20ms)
    ]);

    audio.stdout.on('data', (data) => {
        io.emit('audio', data.toString('base64'));
    });

    audio.stderr.on('data', (data) => {
        console.error('Audio error:', data.toString());
        io.emit('message', 'Audio error: ' + data.toString());
    });

    audio.on('close', () => {
        audiostreaming = false;
        console.log('Audio process closed');
        io.emit('message', 'Audio stream stopped');
    });
}

function stopAudioStream() {
    if (audio) {
        audio.kill('SIGINT');
        audio = null;
        audiostreaming = false;
    }
}





// socket listening stuff
let sensorPoll = null;

io.on('connection', (socket) => {
    console.log('a user connected');

    // handle wheel speed commands
    socket.on('Speedchange', (data) => {
        // console.log(data)
        driveDirect(data.rightSpeed, data.leftSpeed);
    });

    // stop driving on socket disconnect
    socket.on('disconnect', () => {
        // clientsWatching = Math.max(0, clientsWatching - 1);
        // if (clientsWatching === 0) {
        //     stopGlobalVideoStream();
        // }
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

    socket.on('requestSensorData', () => {
        // console.log('Sensor data request:', data);


            console.log('Sensor data start requested')

            function getSensorData() {
                tryWrite(port, [149, 6, 21, 25, 26, 34, 35, 22]); // query charging, battery charge, battery capacity, charging sources, OI mode, battrey voltage
            }

            if (!sensorPoll) {
                console.log('Starting sensor data polling');
                sensorPoll = setInterval(getSensorData, 500); // Poll every 500ms}
                io.emit('message', 'Sensor data polling started');
            } else {
                console.log('Sensor data already being polled');
                clearInterval(sensorPoll);
                sensorPoll = null;
                console.log('Restarting sensor data polling');
                sensorPoll = setInterval(getSensorData, 500); // Restart polling
                io.emit('message', 'Sensor data polling restarted');
            }

        // if (data.action == 'stop') {
        //     console.log('stopping sensor data')
        //     tryWrite(port, [150, 0]); // stop sensor stream
        // }
    })

    socket.on('startVideo', () => {
        // clientsWatching++;
        // if (clientsWatching === 1) {
        //     startGlobalVideoStream();
        // }
        startGlobalVideoStream();
    });

    socket.on('stopVideo', () => {
        // clientsWatching = Math.max(0, clientsWatching - 1);
        // if (clientsWatching === 0) {
        //     stopGlobalVideoStream();
        // }
        stopGlobalVideoStream();
    });


    socket.on('startAudio', () => { 
        console.log('Audio stream started');
        startAudioStream();
        // Start audio stream here
    });
    socket.on('stopAudio', () => {
        console.log('Audio stream stopped');
        stopAudioStream();
        // Stop audio stream here
    });

    socket.on('rebootServer', () => {
        console.log('reboot requested')
        spawn('sudo', ['reboot']);
    })


})
// charging state packet id 21, 0 means not charging
// battery charge packet id 25
// battery capacity packet id 26







// express stuff
// app.get('/', (req, res) => {
//     res.sendFile(__dirname + '/index.html');
// });

app.use(express.static('public'));

server.listen(webport, () => {
    console.log(`Web server is running on http://localhost:${webport}`);
});

