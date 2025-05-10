const { SerialPort } = require('serialport'); 

//web stuff imports
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const { spawn } = require('child_process');
const config = require('./config.json'); // Load configuration from config.json
const { exec } = require('child_process')

// import open like this because its a special snowflake
// also open the browser cause its imported in here
// (async () => {
//     const { default: open } = await import('open')
//     // open('http://example.com')
//     if (roverDisplay) {
//         console.log('Opening rover display');
//         // open(`http://localhost:${webport}/viewer`, {app: {name: 'chromium', arguments: ['--start-fullscreen', '--disable-infobars', '--noerrdialogs', '--disable-web-security', '--allow-file-access-from-files']}}); // open the viewer on the rover display
//         open(`http://localhost:${webport}/viewer`)
//     } else {
//         console.log('Rover display not enabled');
//     }

// })()




// configs
const webport = config.express.port
const portPath = config.serial.port
const baudRate = config.serial.baudrate
const roverDisplay = config.roverDisplay.enabled





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

/**
 * Send a song to the Roomba and play it.
 * 
 * @param {SerialPort} port - An already-open instance of SerialPort
 * @param {number} songNumber - The song number (0–4)
 * @param {[number, number][]} notes - Array of [MIDI note number, duration] pairs
 */
function playRoombaSong(port, songNumber, notes) {
    if (songNumber < 0 || songNumber > 4) {
      throw new Error('Song number must be between 0 and 4.');
    }
    if (notes.length < 1 || notes.length > 16) {
      throw new Error('Song must contain between 1 and 16 notes.');
    }
  
    const songLength = notes.length;
    const songCommand = [140, songNumber, songLength];
  
    for (const [note, duration] of notes) {
      if (note < 31 || note > 127) {
        throw new Error(`Invalid note number: ${note}. Must be between 31 and 127.`);
      }
      if (duration < 0 || duration > 255) {
        throw new Error(`Invalid duration: ${duration}. Must be between 0 and 255.`);
      }
      songCommand.push(note, duration);
    }
  
    const playCommand = [141, songNumber];
  
    port.write(Buffer.from(songCommand), (err) => {
      if (err) {
        console.error('Failed to send song:', err.message);
        return;
      }
  
      // Delay a bit to ensure Roomba registers the song
      setTimeout(() => {
        port.write(Buffer.from(playCommand), (err) => {
          if (err) {
            console.error('Failed to play song:', err.message);
          } else {
            console.log(`Song ${songNumber} is playing.`);
          }
        });
      }, 100); // ms
    });
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

    // open viewer on rover display if enabled

});

port.on('data', (data) => {
    // console.log('Received data:', data.toString());
    // console.log('Raw data:', data);

    try {
        const chargeStatus = data[0];
        const batteryCharge = data.readInt16BE(1);
        const batteryCapacity = data.readInt16BE(3);
        const chargingSources = data[5];
        const oiMode = data[6];
        const batteryVoltage = data.readInt16BE(7);
        const brushCurrent = data.readInt16BE(9);
        const batteryCurrent = data.readInt16BE(11);

        // Emit the parsed data to all connected clients
        io.emit('SensorData', {
            chargeStatus,
            batteryCharge,
            batteryCapacity,
            chargingSources,
            oiMode,
            batteryVoltage,
            brushCurrent,
            batteryCurrent
        });

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
// let clientsWatching = 0;

function startGlobalVideoStream() {
    if (streaming) return;
    streaming = true;
    console.log('Starting video stream...');
    ffmpeg = spawn('ffmpeg', [
        '-f', 'v4l2',
        '-flags', 'low_delay',
        '-fflags', 'nobuffer',
        '-i', config.camera.devicePath,
        '-vf', 'scale=320:240',
        '-r', '30',
        '-q:v', '5',
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
        '-D', config.audio.device,
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
        // io.emit('message', 'Audio stream stopped');
    });
}

function stopAudioStream() {
    if (audio) {
        audio.kill('SIGINT');
        audio = null;
        audiostreaming = false;
    }
}

function toByte(val) {
    return val & 0xFF;
}




// socket listening stuff
let sensorPoll = null;
let clientsOnline = 0;


io.on('connection', (socket) => {
    console.log('a user connected');
    clientsOnline ++
    io.emit('usercount', clientsOnline -1);



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
        clientsOnline --
        io.emit('usercount', clientsOnline -1);
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
                tryWrite(port, [149, 8, 21, 25, 26, 34, 35, 22, 57, 23]); // query charging, battery charge, battery capacity, charging sources, OI mode, battrey voltage, side brush current
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
        
        // Reset the camera device no matter what
        spawn('sudo', ['usbreset', config.camera.USBAddress]); 

    });


    let sideBrushState = 0; // 0 = off, 1 = forward, -1 = reverse
    socket.on('sideBrush', (data) => {
        // // console.log('Side brush command:', data);
        // if (data.action == 'forward') {
        //     // console.log('Starting side brush');
        //     tryWrite(port, [144, 0, toByte(127), 0]); // Start side brush
        // } else if (data.action == 'stop') {
        //     // console.log('Stopping side brush');
        //     tryWrite(port, [144, 0, toByte(0), 0]); // Stop side brush
        // } else if (data.action == 'reverse') {
        //     // console.log('Reversing side brush');
        //     tryWrite(port, [144, 0, toByte(-127), 0]); // Reverse side brush
        // }

        if (data.action == 'forward' && sideBrushState != 1) {
            // console.log('Starting side brush');
            tryWrite(port, [144, 0, toByte(127), 0]); // Start side brush
            sideBrushState = 1;
        } else if (data.action == 'reverse' && sideBrushState != -1) {
            // console.log('Reversing side brush');
            tryWrite(port, [144, 0, toByte(-50), 0]); // Reverse side brush
            sideBrushState = -1;
        } else {
            // console.log('Stopping side brush');
            tryWrite(port, [144, 0, toByte(0), 0]); // Stop side brush
            sideBrushState = 0;
        }
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

    socket.on('userWebcam', (data) => { 
        // console.log('user webcam frame')
        // console.log(data)
        io.emit('userWebcamRe', data);
    })

    socket.on('userMessage', (data) => {
        // console.log('user message', data)
        if (data.beep) {
            playRoombaSong(port, 0, [[60, 15]]);
            // console.log('beep')
        }
        // console.log(data)
        io.emit('userMessageRe', data.message);
    })

    socket.on('userTyping', (data) => {
        // console.log('user typing', data)
        // console.log(data)
        if(data.beep) {
            if (data.message.length === 1) {
                playRoombaSong(port, 0, [[55, 10]]);
                // console.log('typing beep')
            }
        }
        io.emit('userMessageRe', data.message);
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
    if (roverDisplay) {
        console.log('Opening rover display');
        // open(`http://localhost:${webport}/viewer`, {app: {name: 'chromium', arguments: ['--start-fullscreen', '--disable-infobars', '--noerrdialogs', '--disable-web-security', '--allow-file-access-from-files']}}); // open the viewer on the rover display

        //for chromium
        // exec(`DISPLAY=:0 chromium-browser --incognito --start-fullscreen --kiosk --disable-gpu --no-sandbox --disable-infobars --noerrdialogs --disable-web-security --allow-file-access-from-files --hide-crash-restore-bubble --user-data-dir=/tmp/temp_chrome --disable-features=IsolateOrigins,site-per-process http://192.168.0.83:${webport}/viewer`, (error, stdout, stderr) => {
        //     if (error) {
        //         console.error(`Error opening Chrome: ${error.message}`);
        //         return;
        //     }
        //     if (stderr) {
        //         console.error(`Chrome stderr: ${stderr}`);
        //         return;
        //     }
        //     console.log(`Chrome stdout: ${stdout}`);
        // });

        //chrome but simpler
        // exec(`chromium-browser --start-fullscreen --hide-crash-restore-bubble http://192.168.0.83:${webport}/viewer`, (error, stdout, stderr) => {
        //     if (error) {
        //         console.error(`Error opening Chrome: ${error.message}`);
        //         return;
        //     }
        //     if (stderr) {
        //         console.error(`Chrome stderr: ${stderr}`);
        //         return;
        //     }
        //     console.log(`Chrome stdout: ${stdout}`);
        // });


        //for firefox
        // exec(`firefox --kiosk --new-instance --private-window http://127.0.0.1:${webport}/viewer`, (error, stdout, stderr) => {
        //     if (error) {
        //         console.error(`Error opening Firefox: ${error.message}`);
        //         return;
        //     }
        //     if (stderr) {
        //         console.error(`Firefox stderr: ${stderr}`);
        //         return;
        //     }
        //     console.log(`Firefox stdout: ${stdout}`);
        // })

        //for surf
        // exec(`DISPLAY=:0 surf -F http://127.0.0.1:${webport}/viewer`, (error, stdout, stderr) => {
        //     if (error) {
        //         console.error(`Error opening surf: ${error.message}`);
        //         return;
        //     }
        //     if (stderr) {
        //         console.error(`surf stderr: ${stderr}`);
        //         return;
        //     }
        //     console.log(`surf stdout: ${stdout}`);
        // });

        // for epiphany
        exec(`DISPLAY=:0 epiphany -p http://localhost:${webport}/viewer`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error opening epiphany: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`epiphany stderr: ${stderr}`);
                return;
            }
            console.log(`epiphany stdout: ${stdout}`);
        });
    }
});

