const { SerialPort } = require('serialport'); 

// ross is goated

//web stuff imports
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const { spawn } = require('child_process');
var config = require('./config.json'); // Load configuration from config.json
const { exec } = require('child_process')

const { CameraStream, getLatestFrontFrame } = require('./CameraStream')
const { startDiscordBot } = require('./discordBot');
const { isPublicMode } = require('./publicMode');

const { port, tryWrite } = require('./serialPort');
const { driveDirect, playRoombaSong } = require('./roombaCommands');
// const ollamaFile = require('./ollama');
const { AIControlLoop } = require('./ollama');


if(config.discordBot.enabled) {
    startDiscordBot(config.discordBot.botToken)
}


// configs
const webport = config.express.port
const roverDisplay = config.roverDisplay.enabled
const rearCamera = config.rearCamera.enabled
const rearCameraPath = config.rearCamera.devicePath
const rearCameraUSBAddress = config.rearCamera.USBAddress
const authAlert = config.accessControl.noAuthAlert || 'You are unauthenticated.' // default alert if not set


// serial stuffs
// // serial port manager
// function portManager() {
//     let port;

//     return function(action) {
//         if (action === 'open') {
//             if (port && port.isOpen) {
//                 console.log('Port is already open.');
//                 return;
//             }
//             port = new SerialPort({ path: portPath, baudRate: baudRate }, (err) => {
//                 if (err) {
//                     return console.error('Error opening port:', err.message);
//                 }
//                 console.log('Serial port opened successfully');
//             });
//         } else if (action === 'close') {
//             if (port && port.isOpen) {
//                 port.close((err) => {
//                     if (err) {
//                         return console.error('Error closing port:', err.message);
//                     }
//                     console.log('Serial port closed successfully');
//                 });
//             } else {
//                 console.log('Port is not open.');
//             }
//         } else {
//             console.log('Invalid action. Use "open" or "close".');
//         }
//     };
// }


// serial port try write
// function tryWrite(port, command) {

//     try {
//         port.write(Buffer.from(command));
//         // console.log('Command written to port:', command);
//     }
//     catch (err) {
//         console.error('Error writing to port:', err.message);
//     }
// }


// temporary....?
port.on('open', () => {
    console.log('Port is open. Ready to go...');

});

const roombaStatus = {
    docked: null,
    chargeStatus: null,
    batteryVoltage: 16000
}
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
        const bumpSensors = [data.readInt16BE(13), data.readInt16BE(15), data.readInt16BE(17), data.readInt16BE(19), data.readInt16BE(21), data.readInt16BE(23)]
        const wallSignal = data.readInt16BE(25)
        // globalWall = wallSignal
        const rightCurrent = data.readInt16BE(27)
        const leftCurrent = data.readInt16BE(29)

        // console.log(bumpSensors)
        // Emit the parsed data to all connected clients
        io.emit('SensorData', {
            chargeStatus,
            batteryCharge,
            batteryCapacity,
            chargingSources,
            oiMode,
            batteryVoltage,
            brushCurrent,
            batteryCurrent,
            bumpSensors,
            wallSignal,
            rightCurrent,
            leftCurrent
        });

        roombaStatus.docked = (chargingSources === 2)
        roombaStatus.chargeStatus = (chargeStatus != 0 && chargeStatus != 5)
        roombaStatus.batteryVoltage = batteryVoltage

        // console.log(chargingSources)
        // console.log(roombaStatus)


    } catch (err) {
        // console.error('Error parsing data:', err.message);
        return;
    }
    
});


port.on('error', (err) => {
    console.error('Serial port error:', err.message);
});



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

// function toByte(val) {
//     return val & 0xFF;
// }

// config.accessControl.enabled = true


io.use((socket, next) => {
    const token = socket.handshake.auth.token

    if (token === config.accessControl.adminPassword) {
        socket.authenticated = true
        next()
    } else if (isPublicMode()) {
        socket.authenticated = true
        next()
    } else {
        socket.authenticated = false
        next()
    }
})






// socket listening stuff
let sensorPoll = null;
let clientsOnline = 0;


io.on('connection', (socket) => {


    console.log('a user connected');
    clientsOnline ++
    io.emit('usercount', clientsOnline -1);
    if(socket.authenticated) {
        tryWrite(port, [128])
    } else {
        socket.emit('auth-init')
    }

    if(config.ollama.enabled) {
        socket.emit('ollamaEnabled', true);
    }



    // handle wheel speed commands
    socket.on('Speedchange', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

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
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!


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
                // query charging, battery charge, battery capacity, charging sources, OI mode, battrey voltage, side brush current, wall signal sensors, right motor current, left motor current
                tryWrite(port, [149, 17, 21, 25, 26, 34, 35, 22, 57, 23, 46, 47, 48, 49, 50, 51, 27, 55, 54]); 
            }

            if (!sensorPoll) {
                console.log('Starting sensor data polling');
                sensorPoll = setInterval(getSensorData, 50); // Poll every 500ms}
                io.emit('message', 'Sensor data polling started');
            } else {
                console.log('Sensor data already being polled');
                clearInterval(sensorPoll);
                sensorPoll = null;
                console.log('Restarting sensor data polling');
                sensorPoll = setInterval(getSensorData, 50); // Restart polling
                io.emit('message', 'Sensor data polling restarted');
            }

        // if (data.action == 'stop') {
        //     console.log('stopping sensor data')
        //     tryWrite(port, [150, 0]); // stop sensor stream
        // }
    })


    const frontCameraStream = new CameraStream(io, 'frontCamera', config.camera.devicePath, {fps: 30, quality: 5})
    // const rearCameraStream = new CameraStream(io, 'rearCamera', config.rearCamera.devicePath, {fps: 2, quality: 20})


    // rearCameraStream = null

    // if (config.rearCamera.enabled) {
    //     const rearCameraStream = new CameraStream(io, 'rearCamera', config.rearCamera.devicePath, {fps: 1, quality: 10})
    // }

    socket.on('startVideo', () => {
        // clientsWatching++;
        // if (clientsWatching === 1) {
        //     startGlobalVideoStream();
        // }
        frontCameraStream.start()

        if(config.rearCamera.enabled) {
            rearCameraStream.start()
        }


        // startGlobalVideoStream();
        // startRearCameraStream()
    });

    socket.on('stopVideo', () => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // clientsWatching = Math.max(0, clientsWatching - 1);
        // if (clientsWatching === 0) {
        //     stopGlobalVideoStream();
        // }
        // stopGlobalVideoStream();
        // stopRearCameraStream();
        
        // Reset the camera device no matter what
        frontCameraStream.stop()
        // if(config.rearCamera.enabled) {
        //     rearCameraStream.stop()
        // }

        spawn('sudo', ['usbreset', config.camera.USBAddress]); 

        if(config.rearCamera.enabled) {
            spawn('sudo', ['usbreset', config.rearCamera.USBAddress]);
        }

    });


    // let sideBrushState = 0; // 0 = off, 1 = forward, -1 = reverse
    socket.on('sideBrush', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

       
        // speed = data.speed
        // tryWrite(port, [144, 0, toByte(data.speed), 0]); // set side brush speed
        auxMotorSpeeds(undefined, data.speed, undefined)
        // console.log(`brush speed ${data.speed}`)


    });

    socket.on('vacuumMotor', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // tryWrite(port, [144, 0, 0, toByte(data.speed)]) //set motor speed
        auxMotorSpeeds(undefined, undefined, data.speed)
    })


    var mainBrushSave = 0
    var sideBrushSave = 0
    var vacuumMotorSave = 0

    function auxMotorSpeeds(mainBrush, sideBrush, vacuumMotor) {
        try {
            if (mainBrush !== undefined && mainBrush !== null) {
                mainBrushSave = mainBrush
            }
            if (sideBrush !== undefined && sideBrush !== null) {
                sideBrushSave = sideBrush
            }
            if (vacuumMotor !== undefined && vacuumMotor !== null) {
                vacuumMotorSave = vacuumMotor
            }
        } catch (e) {
            // Optional: handle error
        }

        tryWrite(port, [144, mainBrushSave, sideBrushSave, vacuumMotorSave])
        console.log(`Aux motors: `, mainBrushSave, sideBrushSave, vacuumMotorSave)
    }


    socket.on('startAudio', () => { 
        console.log('Audio stream started');
        startAudioStream();
        // Start audio stream here
    });
    socket.on('stopAudio', () => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        console.log('Audio stream stopped');
        stopAudioStream();
        // Stop audio stream here
    });

    socket.on('rebootServer', () => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        console.log('reboot requested')
        spawn('sudo', ['reboot']);
    })

    socket.on('userWebcam', (data) => { 
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // console.log('user webcam frame')
        // console.log(data)
        io.emit('userWebcamRe', data);
    })

    socket.on('userMessage', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // console.log('user message', data)
        if (data.beep) {
            playRoombaSong(port, 0, [[60, 15]]);
            console.log('beep')
        }
        // console.log(data)
        io.emit('userMessageRe', data.message);
    })

    socket.on('userTyping', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // console.log('user typing', data)
        // console.log(data)
        if(data.beep) {
            if (data.message.length === 1) {
                playRoombaSong(port, 1, [[58, 15]]);
                console.log('typing beep')
            }
        }
        io.emit('userTypingRe', data.message);
    })

    socket.on('wallFollowMode', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        if (data.enable) {
            console.log('enabling wall following!!')
            console.log('jk!! this doesnt exist!')

        } else {

        }
    })



    socket.on('easyStart', () => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        console.log('initiating easy start')
        // send dock message then start message, kinda janky but might work
        // turns out it does work!!
        tryWrite(port, [143])

        tryWrite(port, [132])
    })

    socket.on('easyDock', () => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        console.log('initating easy dock')
        tryWrite(port, [143])

    })

    socket.on('enableAIMode', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // console.log('enabling AI mode')
        if (data.enabled) {
            console.log('enabling AI mode')
            io.emit('message', 'AI mode enabled, sending first image.');
            socket.emit('aiModeEnabled', true);
            // aiMode()
            AIControlLoop.start()

            // ollamaFile.runChatFromCameraImage();
            // frontCameraStream.startAIProcessing(runChatFromCameraImage)
        } else {
            console.log('disabling AI mode')
            io.emit('message', 'AI mode disabled');
            socket.emit('aiModeEnabled', false);
            AIControlLoop.stop()
            // frontCameraStream.stopAIProcessing()
        }
    })

    // async function aiMode() {
    //     runChatFromCameraImage(getLatestFrontFrame())
    // }


}) 

AIControlLoop.on('ollamaResponse', (response) => {
    // console.log('Ollama response:', response);
    io.emit('ollamaResponse', response); 
    io.emit('message', 'AI response recieved! Processing current image...')
    io.emit('userMessageRe', response); // send the response to the user
});

// charging state packet id 21, 0 means not charging
// battery charge packet id 25
// battery capacity packet id 26


DOCK_IDLE_TIMEOUT_MS = 10 * 1000
let dockIdleStartTime = null

function autoCharge() {
    const now = Date.now()

    if (roombaStatus.docked) {
        AIControlLoop.stop() // stop AI mode if docked
    }

    if (roombaStatus.docked && !roombaStatus.chargeStatus) {

        if (!dockIdleStartTime) {
            console.log('roomba is docked but not charging! starting 10s timer...')
            io.emit('message', 'Autocharging timer started')

            // create 10s timer
            dockIdleStartTime = now

        } else if (now - dockIdleStartTime > DOCK_IDLE_TIMEOUT_MS) {

            console.log('10s elapsed since first non charging, switching to dock mode to charge')
            io.emit('message', 'Autocharging initiated')
            // playRoombaSong(port, 1, [[32, 15]])
            tryWrite(port, [143])

            dockIdleStartTime = null

        }

    } else {
        if (dockIdleStartTime) {
            console.log('conditions not met, resetting timer')
            io.emit('message', 'Resetting autocharge timer')
            dockIdleStartTime = null    
        }
        
    }
}

setInterval(autoCharge, 1000)

let alarming = false
function batteryAlarm() {
    if (roombaStatus.batteryVoltage < 13000) {
    // if (roombaStatus.batteryVoltage < 15800) {

        console.log('battery low!!')

        playRoombaSong(port, 0, [[78, 15]])
        alarming = true
    } else {
        alarming = false
    }

    // alarming ? io.emit('alert', 'battery low!! sounding alarm!!'):null

    if(alarming) {
        io.emit('alert', 'BATTERY LOW, CHARGE NOW')
    }


}

setInterval(batteryAlarm, 1000)




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

        // exec('startx')
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

