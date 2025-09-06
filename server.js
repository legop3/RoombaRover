const logCapture = require('./logCapture')
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
const os = require('os');

const { CameraStream } = require('./CameraStream')
const { startDiscordBot } = require('./discordBot');
const { isPublicMode, publicModeEvent } = require('./publicMode');

const { port, tryWrite } = require('./serialPort');
const { driveDirect, playRoombaSong } = require('./roombaCommands');
// const ollamaFile = require('./ollama');
const { AIControlLoop, setGoal, speak, setParams, getParams } = require('./ollama');
const roombaStatus = require('./roombaStatus')


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

var aimode = false


const frontCameraStream = new CameraStream(io, 'frontCamera', config.camera.devicePath, {fps: 30, quality: 5})

// lightweight system stats for web UI
let lastCpuInfo = os.cpus();
function getCpuUsage() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (let i = 0; i < cpus.length; i++) {
        const current = cpus[i].times;
        const last = lastCpuInfo[i].times;
        const idleDiff = current.idle - last.idle;
        const totalDiff = (current.user - last.user) + (current.nice - last.nice) +
            (current.sys - last.sys) + (current.irq - last.irq) + idleDiff;
        idle += idleDiff;
        total += totalDiff;
    }
    lastCpuInfo = cpus;
    return total ? Math.round(100 - (idle / total) * 100) : 0;
}

function getMemoryUsage() {
    return Math.round(100 - (os.freemem() / os.totalmem()) * 100);
}

setInterval(() => {
    if (io.engine.clientsCount === 0) return;
    io.emit('system-stats', {
        cpu: getCpuUsage(),
        memory: getMemoryUsage()
    });
}, 5000);


// Access captured logs
// setTimeout(() => {
//     console.log('Captured logs:', logCapture.getLogs());
// }, 10000);


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

// temporary....?
port.on('open', () => {
    console.log('Port is open. Ready to go...');

});


let errorCount = 0;
let startTime = Date.now();

let dataBuffer = Buffer.alloc(0)
const expectedPacketLength = 40; // Length of the expected sensor data packet
// const minValidPacketsForSync = 3;
let consecutiveValidPackets = 0;

port.on('data', (data) => {
    // Append new data to buffer
    dataBuffer = Buffer.concat([dataBuffer, data]);
    
    // Process complete packets
    while (dataBuffer.length >= expectedPacketLength) {
        const packet = dataBuffer.slice(0, expectedPacketLength);
        
        // Validate packet before processing
        if (isValidPacket(packet)) {
            consecutiveValidPackets++;
            dataBuffer = dataBuffer.slice(expectedPacketLength);
            processPacket(packet);
        } else {
            // Invalid packet - try to resync
            console.log('Invalid packet detected, attempting resync...');
            io.emit('warning', 'Invalid packet detected, attempting resync...');
            consecutiveValidPackets = 0;
            
            // Try to find valid packet start by shifting one byte at a time
            let foundSync = false;
            for (let i = 1; i < Math.min(dataBuffer.length - expectedPacketLength + 1, 50); i++) {
                const testPacket = dataBuffer.slice(i, i + expectedPacketLength);
                if (isValidPacket(testPacket)) {
                    console.log(`Found sync at offset ${i}`);
                    io.emit('warning', `Found sync at offset ${i}`);
                    dataBuffer = dataBuffer.slice(i);
                    foundSync = true;
                    break;
                }
            }
            
            if (!foundSync) {
                // No valid packet found, clear buffer
                console.log('No valid sync found, clearing buffer...');
                io.emit('warning', 'No valid sync found, clearing buffer...');
                dataBuffer = Buffer.alloc(0);
            }
        }
    }
    
    // Clear buffer if it gets too large (indicates persistent sync issues)
    if (dataBuffer.length > expectedPacketLength * 5) {
        console.log('Buffer too large, clearing to resync...');
        io.emit('warning', 'Buffer too large, clearing to resync...');
        dataBuffer = Buffer.alloc(0);
        consecutiveValidPackets = 0;
    }
});


function isValidPacket(data) {
    if (data.length !== expectedPacketLength) return false;
    
    try {
        // Basic validation checks - more lenient to handle different modes
        const chargeStatus = data[0];
        const batteryCharge = data.readInt16BE(1);
        const batteryCapacity = data.readInt16BE(3);
        const chargingSources = data[5];
        const oiMode = data[6];
        const batteryVoltage = data.readInt16BE(7);
        
        // More lenient validation - only check for obviously invalid values
        
        // Battery voltage should be reasonable (5-20V = 5000-20000 mV)
        if (batteryVoltage < 1000 || batteryVoltage > 20000) return false;
        
        // Charge status should be within byte range
        if (chargeStatus < 0 || chargeStatus > 255) return false;
        
        // OI mode should be within byte range (expanded to handle all possible modes)
        if (oiMode < 0 || oiMode > 255) return false;
        
        // Charging sources should be within byte range
        if (chargingSources < 0 || chargingSources > 255) return false;
        
        // Battery capacity should be reasonable (allow wider range)
        if (batteryCapacity < 1000 || batteryCapacity > 15000) return false;
        
        // Additional check: see if bump sensor values are reasonable
        const bumpSensor1 = data.readInt16BE(13);
        const bumpSensor2 = data.readInt16BE(15);
        
        // Light bump sensors should be within reasonable range (0-4095 typical)
        if (bumpSensor1 < 0 || bumpSensor1 > 5000) return false;
        if (bumpSensor2 < 0 || bumpSensor2 > 5000) return false;
        
        return true;
    } catch (err) {
        return false;
    }
}

function processPacket(data) {
    // console.log('Processing packet:', data);
    // console.log('Processing packet length:', data.length);
    // console.log(`Processing packet with length: ${data.length}, consecutive valid packets: ${consecutiveValidPackets}`);2
    try {
        const chargeStatus = data[0];
        const batteryCharge = data.readInt16BE(1);
        const batteryCapacity = data.readInt16BE(3);
        const chargingSources = data[5];
        const oiMode = data[6];
        const batteryVoltage = data.readInt16BE(7);
        const brushCurrent = data.readInt16BE(9);
        const batteryCurrent = data.readInt16BE(11);
        // Only include the six light bump sensors on the front of the robot
        const bumpSensors = Array.from({ length: 6 }, (_, i) =>
            data.readInt16BE(13 + i * 2)
        );
        const wallSignal = data.readInt16BE(25)
        // globalWall = wallSignal
        const rightCurrent = data.readInt16BE(27)
        const leftCurrent = data.readInt16BE(29)

        const bumpRight = data[31] & 0x01; // Bump left sensor
        const bumpLeft = (data[31] & 0x02) >> 1; // Bump right sensor
        const wheelDropRight = (data[31] & 0x04) >> 2; // Wheel drop right sensor
        const wheelDropLeft = (data[31] & 0x08) >> 3; // Wheel drop left sensor

        const cliffSensors = [
            data.readInt16BE(32),
            data.readInt16BE(34),
            data.readInt16BE(36),
            data.readInt16BE(38)
        ]

        
        // console.log(cliffSensors)

        // console.log(bumpLeft, bumpRight, wheelDropRight, wheelDropLeft)



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
            leftCurrent,
            bumpLeft,
            bumpRight,
            wheelDropRight,
            wheelDropLeft,
            cliffSensors
        });


        roombaStatus.docked = (chargingSources === 2)
        roombaStatus.chargeStatus = (chargeStatus != 0 && chargeStatus != 5)
        roombaStatus.batteryVoltage = batteryVoltage

        roombaStatus.lightBumps.LBL = bumpSensors[0]
        roombaStatus.lightBumps.LBFL = bumpSensors[1]
        roombaStatus.lightBumps.LBCL = bumpSensors[2]
        roombaStatus.lightBumps.LBCR = bumpSensors[3]
        roombaStatus.lightBumps.LBFR = bumpSensors[4]
        roombaStatus.lightBumps.LBR = bumpSensors[5]

        // console.log(chargingSources)
        // console.log(roombaStatus)

        // console.log(`bump sensors: left: ${bumpLeft} right: ${bumpRight}`)

        roombaStatus.bumpSensors.bumpLeft = bumpLeft ? 'ON' : 'OFF';
        roombaStatus.bumpSensors.bumpRight = bumpRight ? 'ON' : 'OFF';

        roombaStatus.batteryPercentage = Math.round((batteryCharge / batteryCapacity) * 100);



        
 
        
        } catch (err) {
            // console.error('Error parsing data:', err.message);
            errorCount++;
            
            // Calculate errors per second every 10 seconds
            const currentTime = Date.now();
            const elapsedSeconds = (currentTime - startTime) / 1000;
            
            if (elapsedSeconds >= 10) {
                const errorsPerSecond = errorCount / elapsedSeconds;
                console.log(`Errors per second: ${errorsPerSecond.toFixed(2)}`);
                
                // Reset counters
                errorCount = 0;
                startTime = currentTime;
            }
            
            return;
        }

}


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
        io.emit('audio', data);
    });

    audio.stderr.on('data', (data) => {
        // console.error('Audio error:', data.toString());
        // io.emit('message', 'Audio error: ' + data.toString());
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


io.on('connection', async (socket) => {


    console.log('a user connected');
    clientsOnline ++
    io.emit('usercount', clientsOnline -1);
    // io.emit('userlist', io.fetchSockets())
    // console.log(await io.fetchSockets())
    io.emit('userlist', await io.fetchSockets().then(sockets => sockets.map(s => ({ id: s.id, authenticated: s.authenticated }))));
    io.emit('ollamaParamsRelay', getParams())
    
    if(socket.authenticated) {
        // tryWrite(port, [128])
    } else {
        socket.emit('auth-init')
    }

    if(config.ollama.enabled) {
        socket.emit('ollamaEnabled', true);
        // socket.emit('ollamaResponse', '...'); 
        socket.emit('aiModeEnabled', aimode); // send the current AI mode status to the client
    }




    // handle wheel speed commands
    socket.on('Speedchange', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // console.log(data)
        driveDirect(data.rightSpeed, data.leftSpeed);

    });

    // stop driving on socket disconnect
    socket.on('disconnect', async () => {
        // clientsWatching = Math.max(0, clientsWatching - 1);
        // if (clientsWatching === 0) {
        //     stopGlobalVideoStream();
        // }
        console.log('user disconnected')
        clientsOnline --
        io.emit('usercount', clientsOnline -1);

        // console.log(await io.fetchSockets())
        io.emit('userlist', await io.fetchSockets().then(sockets => sockets.map(s => ({ id: s.id, authenticated: s.authenticated }))));
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
                // query charging, battery charge, battery capacity, charging sources, OI mode, battrey voltage, side brush current, wall signal sensors, right motor current, left motor current, bumps and wheel drops
                tryWrite(port, [149, 23, 21, 25, 26, 34, 35, 22, 57, 23, 46, 47, 48, 49, 50, 51, 27, 55, 54, 7, 28, 29, 30, 31, 15]); 
            }

            if (!sensorPoll) {
                console.log('Starting sensor data polling');
                sensorPoll = setInterval(getSensorData, 60); // Poll every 500ms}
                io.emit('message', 'Sensor data polling started');
            } else {
                console.log('Sensor data already being polled');
                clearInterval(sensorPoll);
                sensorPoll = null;
                console.log('Restarting sensor data polling');
                sensorPoll = setInterval(getSensorData, 60); // Restart polling
                io.emit('message', 'Sensor data polling restarted');
            }

            // tryWrite(port, [148, 58, 100])

            // tryWrite(port, [133])

        // if (data.action == 'stop') {
        //     console.log('stopping sensor data')
        //     tryWrite(port, [150, 0]); // stop sensor stream
        // }
    })


    // const frontCameraStream = new CameraStream(io, 'frontCamera', config.camera.devicePath, {fps: 30, quality: 5})
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
            // rearCameraStream.start()
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

    socket.on('brushMotor', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        auxMotorSpeeds(data.speed, undefined, undefined)
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
            speak(data.message) // speak the message
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

        // tryWrite(port, [133]) // power off

        AIControlLoop.stop()
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
            // socket.emit('aiModeEnabled', true);
            AIControlLoop.start()
            aimode = true

        } else {
            console.log('disabling AI mode')
            io.emit('message', 'AI mode disabled');
            // socket.emit('aiModeEnabled', false);
            AIControlLoop.stop()
            aimode = false
        }
    })

    socket.on('setGoal', (data) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        console.log('setting new goal:', data.goal)
        setGoal(data.goal); // set the goal in the AI control loop
        io.emit('message', `New goal set: ${data.goal}`); // send a message to the user
        // AIControlLoop.start() // start the AI control loop if not already started
    })

    socket.on('requestLogs', () => {
        // if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // console.log('requesting logs')
        const logs = logCapture.getLogs();
        socket.emit('logs', logs);
    })

    socket.on('resetLogs', () => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        console.log('resetting logs')
        logCapture.clearLogs();
        socket.emit('logs', 'Logs cleared.');
    })

    socket.on('ollamaParamsPush', (params) => {
        if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!

        // console.log('setting ollama params from server:', params)
        // set the parameters in the AI control loop
        setParams(params.movingParams);
        socket.broadcast.emit('ollamaParamsRelay', getParams()); // send the updated parameters to the user
    })

}) 


var typingtext = ''
AIControlLoop.on('responseComplete', (response) => {
    // console.log('full ollama response from main: ', response)
    typingtext = '' // reset the typing text
    io.emit('userTypingRe', typingtext); // send the reset typing text to the user
    io.emit('userMessageRe', response); // send the response to the display
})

AIControlLoop.on('streamChunk', (chunk) => {
    // console.log(chunk)
    io.emit('ollamaStreamChunk', chunk); // send the stream chunk to the user
    typingtext += chunk // append the chunk to the typing text
    io.emit('userTypingRe', typingtext); // send the stream chunk to the user as a typing indicator
})

AIControlLoop.on('controlLoopIteration', (iterationInfo) => {
    // console.log(`Control Loop Iteration: ${iterationInfo.iterationCount}`);
    io.emit('controlLoopIteration', iterationInfo); // send the iteration count to the user
    // io.emit('message', `Control Loop Iteration: ${iterationInfo.iterationCount}`); // send the iteration count to the user



});

AIControlLoop.on('aiModeStatus', (status) => {
    console.log('AI mode status:', status);
    io.emit('aiModeEnabled', status); // send the AI mode status to the user
    if (status) {
        io.emit('message', 'AI mode enabled, sending first image.');
    } else {
        io.emit('message', 'AI mode disabled');
    }
});

AIControlLoop.on('goalSet', (goalText) => {
    console.log('New goal received:', goalText);
    io.emit('newGoal', goalText); // send the new goal to the user
});


logCapture.on('logEvent', () => {
    io.emit('logs', logCapture.getLogs()); 
})

publicModeEvent.on('publicModeChanged', (data) => {
    console.log('Public mode status:', data.enabled);
    // io.emit('publicModeStatus', isPublic); // send the public mode status to the user
    // io.sockets.sockets.forEach(socket => {
        // socket.authenticated = data.enabled
    // data.enabled ?  null : io.disconnectSockets(); // disconnect all sockets to force re-authentication
    // })

    if(!data.enabled) {
        console.log('Public mode disabled, disconnecting all sockets (except for the display');
        io.sockets.sockets.forEach(socket => {
            if (socket.handshake.address = '127.0.0.1') {
                return
            }
            socket.disconnect(true)
        })
    }

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

// app.get('/stream/:cameraId', (req, res) => {
//     let camera;
    
//     if (req.params.cameraId === 'frontCamera') {
//         camera = frontCameraStream;
//     } else if (req.params.cameraId === 'rearCamera' && config.rearCamera.enabled) {
//         camera = rearCameraStream;
//     }
    
//     if (camera) {
//         camera.addClient(res);
//     } else {
//         res.status(404).send('Camera not found');
//     }
// });

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

