const logCapture = require('./logCapture')
const { SerialPort } = require('serialport'); 
const { createLogger, setLogLevel } = require('./logger');

const logger = createLogger('Server');
const socketLogger = logger.child('Socket');
const sensorLogger = logger.child('Sensor');
const audioLogger = logger.child('Audio');
const commandLogger = logger.child('Command');
const aiLogger = logger.child('AI');

// ross is goated

//web stuff imports
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const ioContext = require('./ioContext');
const io = new Server(server);


// send the io object to the global handler module for it
ioContext.setServer(io);

io.use((socket, next) => {
    if (!socket.nickname) {
        socket.nickname = generateDefaultNickname(socket.id);
    }
    next();
});

const { spawn, exec } = require('child_process');
var config = require('./config'); // Load configuration from config.yaml

if (config?.logging?.level) {
    try {
        setLogLevel(config.logging.level);
        logger.info(`Log level set from config: ${config.logging.level}`);
    } catch (error) {
        logger.warn(`Invalid log level in config: ${config.logging.level}`, error);
    }
}
// const { exec } = require('child_process')
const os = require('os');

const { CameraStream } = require('./CameraStream')
const accessControl = require('./accessControl');
const { startDiscordBot, alertAdmins } = require('./discordBot');
// const { isPublicMode, publicModeEvent } = require('./publicMode');

const { port, tryWrite } = require('./serialPort');
const { driveDirect, playRoombaSong, auxMotorSpeeds } = require('./roombaCommands');
// const ollamaFile = require('./ollama');
const { AIControlLoop, setGoal, speak, setParams, getParams } = require('./ollama');
const roombaStatus = require('./roombaStatus')
const batteryManager = require('./batteryManager');

const turnHandler = require('./turnHandler');

require('./roomCamera');


function buildUiConfig() {
    const rawInvite = config.discordBot && typeof config.discordBot.inviteURL === 'string'
        ? config.discordBot.inviteURL.trim()
        : '';

    return {
        discordInviteURL: rawInvite || null,
    };
}

app.get('/discord-invite', (req, res) => {
    const { discordInviteURL } = buildUiConfig();
    if (!discordInviteURL) {
        res.status(204).send('');
        return;
    }

    res.type('text/plain').send(discordInviteURL);
});

function generateDefaultNickname(socketId) {
    const suffix = typeof socketId === 'string' && socketId.length >= 4
        ? socketId.slice(-4)
        : Math.random().toString(36).slice(-4);
    return `User ${suffix}`;
}

const EVENT_ALLOWED_WHEN_NOT_DRIVING = new Set(['setNickname', 'userMessage', 'userTyping']);

async function broadcastUserList() {
    try {
        const sockets = await io.fetchSockets();
        const users = sockets.map((s) => ({
            id: s.id,
            authenticated: s.authenticated,
            nickname: s.nickname || generateDefaultNickname(s.id),
        }));
        io.emit('userlist', users);
    } catch (error) {
        socketLogger.error('Failed to broadcast user list', error);
    }
}

function sanitizeNickname(rawNickname) {
    if (typeof rawNickname !== 'string') return '';
    const trimmed = rawNickname.trim();
    if (!trimmed) return '';
    // Allow basic latin letters, numbers, spaces, dashes and underscores.
    const cleaned = trimmed.replace(/[^A-Za-z0-9 _\-]/g, '');
    return cleaned.slice(0, 24);
}

const accessControlState = accessControl.state;

if(config.discordBot.enabled) {
    startDiscordBot(config.discordBot.botToken)
}


// configs
const webport = config.express.port
const roverDisplay = config.roverDisplay.enabled
// const rearCamera = config.rearCamera.enabled
// const rearCameraPath = config.rearCamera.devicePath
// const rearCameraUSBAddress = config.rearCamera.USBAddress
// const authAlert = config.accessControl.noAuthAlert || 'You are unauthenticated.' // default alert if not set

var aimode = false

batteryManager.initializeBatteryManager({
    config,
    io,
    turnHandler,
    roombaStatus,
    alertAdmins: config.discordBot?.enabled ? alertAdmins : null,
    playLowBatteryTone: () => playRoombaSong(port, 0, [[78, 15]]),
    accessControlState,
    triggerDockCommand: () => tryWrite(port, [143]),
    stopAiControlLoop: () => AIControlLoop.stop(),
});


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

// temporary....? (nope :3)
port.on('open', () => {
    sensorLogger.info('Serial port open; ready to receive data');

});


let errorCount = 0;
let startTime = Date.now();

let dataBuffer = Buffer.alloc(0)
const expectedPacketLength = 44; // Length of the expected sensor data packet
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
            sensorLogger.warn('Invalid sensor packet detected; attempting resync');
            io.emit('warning', 'Invalid packet detected, attempting resync...');
            consecutiveValidPackets = 0;
            
            // Try to find valid packet start by shifting one byte at a time
            let foundSync = false;
            for (let i = 1; i < Math.min(dataBuffer.length - expectedPacketLength + 1, 50); i++) {
                const testPacket = dataBuffer.slice(i, i + expectedPacketLength);
                if (isValidPacket(testPacket)) {
                    sensorLogger.debug(`Found sensor packet sync at offset ${i}`);
                    io.emit('warning', `Found sync at offset ${i}`);
                    dataBuffer = dataBuffer.slice(i);
                    foundSync = true;
                    break;
                }
            }
            
            if (!foundSync) {
                // No valid packet found, clear buffer
                sensorLogger.warn('No valid sync found; clearing sensor buffer');
                io.emit('warning', 'No valid sync found, clearing buffer...');
                dataBuffer = Buffer.alloc(0);
            }
        }
    }
    
    // Clear buffer if it gets too large (indicates persistent sync issues)
    if (dataBuffer.length > expectedPacketLength * 5) {
        sensorLogger.warn('Sensor buffer too large; clearing to resync');
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
        if (chargeStatus < 0 || chargeStatus > 6) return false;
        
        // OI mode should be within byte range (expanded to handle all possible modes)
        if (oiMode < 0 || oiMode > 255) return false;
        
        // Charging sources should be within byte range
        if (chargingSources < 0 || chargingSources > 255) return false;
        
        // Battery capacity should be reasonable (allow wider range)
        if (batteryCapacity < 2068 || batteryCapacity > 2068) return false;
        
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

        const dirtDetect = data[40]
        const mainBrushCurrent = data.readInt16BE(41)
        const overcurrentBits = data[43]
        const overcurrents = {
            leftWheel: (overcurrentBits & 0x10) ? 'ON' : 'OFF',
            rightWheel: (overcurrentBits & 0x08) ? 'ON' : 'OFF',
            mainBrush: (overcurrentBits & 0x04) ? 'ON' : 'OFF',
            sideBrush: (overcurrentBits & 0x01) ? 'ON' : 'OFF'
        }
        // console.log(`Main brush current: ${mainBrushCurrent} mA`)
        // console.log(dirtDetect)

        
        // console.log(cliffSensors)

        // console.log(bumpLeft, bumpRight, wheelDropRight, wheelDropLeft)


        const batteryInfo = batteryManager.handleSensorUpdate({
            chargeStatus,
            batteryCharge,
            batteryCapacity,
            batteryVoltage,
            chargingSources,
        });

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

        roombaStatus.overcurrents = overcurrents

        const computedPercentage = batteryInfo.batteryPercentage;
        const filteredVoltage = batteryInfo.filteredVoltage;
        const chargeAlert = batteryInfo.chargeAlert;

        // Emit the parsed data to all connected clients
        io.emit('SensorData', {
            chargeStatus,
            batteryCharge,
            batteryCapacity,
            batteryPercentage: computedPercentage,
            chargingSources,
            oiMode,
            batteryVoltage,
            batteryVoltageFiltered: filteredVoltage,
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
            cliffSensors,
            mainBrushCurrent,
            dirtDetect,
            overcurrents,
            chargeAlert
        });



        
 
        
        } catch (err) {
            // console.error('Error parsing data:', err.message);
            errorCount++;
            
            // Calculate errors per second every 10 seconds
            const currentTime = Date.now();
            const elapsedSeconds = (currentTime - startTime) / 1000;
            
            if (elapsedSeconds >= 10) {
                const errorsPerSecond = errorCount / elapsedSeconds;
                sensorLogger.warn(`Sensor packet parse errors per second: ${errorsPerSecond.toFixed(2)}`);
                
                // Reset counters
                errorCount = 0;
                startTime = currentTime;
            }
            
            return;
        }

}


port.on('error', (err) => {
    sensorLogger.error('Serial port error', err);
});



// audio streaming stuff
let audiostreaming = false
let audio = null
function startAudioStream() {
    if (audiostreaming) return;
    audiostreaming = true;
    audioLogger.info('Starting audio stream');
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
        audioLogger.info('Audio process closed');
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



// socket listening stuff
let sensorPoll = null;
let clientsOnline = 0;

const viewerspace = io.of('/viewer');
viewerspace.on('connection', (socket) => {
    socketLogger.debug(`Viewer connected: ${socket.id}`);
    viewerspace.emit('usercount', clientsOnline);

});

io.on('connection', async (socket) => {

    socket.nickname = generateDefaultNickname(socket.id);
    socket.emit('nickname:update', { userId: socket.id, nickname: socket.nickname });
    socket.emit('ui-config', buildUiConfig());

    socket.use((packet, next) => {
        const eventName = Array.isArray(packet) ? packet[0] : undefined;
        if (EVENT_ALLOWED_WHEN_NOT_DRIVING.has(eventName)) {
            return next();
        }
        if (socket.driving || socket.isAdmin) {
            return next();
        }
        socket.emit('alert', 'You are not currently driving');
    })

    //////////////////////////////////////////////////////////////////////////////////////////////////

    socketLogger.info(`User connected: ${socket.id}`);
    clientsOnline ++
    io.emit('usercount', clientsOnline);
    viewerspace.emit('usercount', clientsOnline);
    await broadcastUserList();
    io.emit('ollamaParamsRelay', getParams())
    

    if(config.ollama.enabled && socket.isAdmin) {
        
        socket.emit('ollamaEnabled', true);
        // socket.emit('ollamaResponse', '...'); 
        socket.emit('aiModeEnabled', aimode); // send the current AI mode status to the client
    }
    if(socket.isAdmin) {
        socket.emit('admin-login', accessControlState.mode);
        socketLogger.debug(`Admin ${socket.id} login; mode=${accessControlState.mode}`);
    }

    socket.on('setNickname', async (rawNickname) => {
        const sanitized = sanitizeNickname(rawNickname);
        const nickname = sanitized || generateDefaultNickname(socket.id);

        if (socket.nickname === nickname) {
            socket.emit('nickname:update', { userId: socket.id, nickname });
            return;
        }

        socket.nickname = nickname;
        const payload = { userId: socket.id, nickname };
        socket.emit('nickname:update', payload);
        socket.broadcast.emit('nickname:update', payload);

        await broadcastUserList();

        if (typeof turnHandler.forceBroadcast === 'function') {
            turnHandler.forceBroadcast();
        }
    });




    // handle wheel speed commands
    socket.on('Speedchange', (data) => {
//         if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!


        // console.log(data)
        socket.lastDriveCommandAt = Date.now();
        roombaStatus.lastDriveCommandAt = socket.lastDriveCommandAt;
        driveDirect(data.rightSpeed, data.leftSpeed);

    });

    // stop driving on socket disconnect
    socket.on('disconnect', async () => {
        socketLogger.info(`User disconnected: ${socket.id}`);
        clientsOnline --
        io.emit('usercount', clientsOnline -1);
        await broadcastUserList();
        driveDirect(0, 0);

    });

    // handle docking and reinit commands
    socket.on('Docking', (data) => {
//         if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!



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


            sensorLogger.info('Sensor data stream requested');

            function getSensorData() {
                // query charging, battery charge, battery capacity, charging sources, OI mode, battrey voltage, side brush current, wall signal sensors, right motor current, left motor current, bumps, wheel drops, dirt detect, wheel overcurrents
                tryWrite(port, [149, 25, 21, 25, 26, 34, 35, 22, 57, 23, 46, 47, 48, 49, 50, 51, 27, 55, 54, 7, 28, 29, 30, 31, 15, 56, 14]); 
            }

            if (!sensorPoll) {
                sensorLogger.info('Starting sensor data polling');
                sensorPoll = setInterval(getSensorData, 60); // poll every 60ms
                io.emit('message', 'Sensor data polling started');
            } else {
                sensorLogger.debug('Sensor data already being polled; restarting');
                clearInterval(sensorPoll);
                sensorPoll = null;
                sensorLogger.info('Restarting sensor data polling');
                sensorPoll = setInterval(getSensorData, 60); // Restart polling
                io.emit('message', 'Sensor data polling restarted');
            }

    })


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
        if (!socket.isAdmin) return

        frontCameraStream.stop()

        spawn('sudo', ['usbreset', config.camera.USBAddress]); 

        if(config.rearCamera.enabled) {
            spawn('sudo', ['usbreset', config.rearCamera.USBAddress]);
        }

    });


    socket.on('sideBrush', (data) => {

        auxMotorSpeeds(undefined, data.speed, undefined)
    });

    socket.on('vacuumMotor', (data) => {

        auxMotorSpeeds(undefined, undefined, data.speed)
    })

    socket.on('brushMotor', (data) => {

        auxMotorSpeeds(data.speed, undefined, undefined)
    })





    socket.on('startAudio', () => { 
        audioLogger.info('Audio stream start requested');
        startAudioStream();
    });
    socket.on('stopAudio', () => {


        audioLogger.info('Audio stream stop requested');
        stopAudioStream();
        // Stop audio stream here
    });

    socket.on('rebootServer', () => {
        if(!socket.isAdmin) return


        commandLogger.warn(`Reboot requested by ${socket.id}`);
        spawn('sudo', ['reboot']);
    })

    socket.on('userWebcam', (data) => { 
        viewerspace.emit('userWebcamRe', data);
    })

    socket.on('userMessage', (data = {}) => {
        const rawMessage = typeof data.message === 'string' ? data.message : '';
        const message = rawMessage.trim().slice(0, 240);
        if (!message) return;

        const nickname = socket.nickname || generateDefaultNickname(socket.id);
        const payload = {
            message,
            nickname,
            userId: socket.id,
            timestamp: Date.now(),
        };

        if (data.beep) {
            playRoombaSong(port, 0, [[60, 15]]);
            commandLogger.debug('Chat beep requested');
            speak(message) // speak the message
        }
        viewerspace.emit('userMessageRe', payload);
        io.emit('userMessageRe', payload);
    })

    socket.on('userTyping', (data) => {
        if(data.beep) {
            if (data.message.length === 1) {
                playRoombaSong(port, 1, [[58, 15]]);
                commandLogger.debug('Typing beep triggered');
            }
        }
        viewerspace.emit('userTypingRe', data.message);
    })

    socket.on('wallFollowMode', (data) => {


        if (data.enable) {
            commandLogger.warn(`Wall-follow mode requested by ${socket.id}, but feature not implemented`);

        } else {

        }
    })



    socket.on('easyStart', () => {


        commandLogger.info('Executing easy start sequence');
        // send dock message then start message, kinda janky but might work
        // turns out it does work!!
        tryWrite(port, [143])

        tryWrite(port, [132])


        AIControlLoop.stop()
    })

    socket.on('easyDock', () => {

        commandLogger.info('Executing easy dock command');
        tryWrite(port, [143])

    })
    socket.on('enableAIMode', (data) => {

        if (data.enabled) {
            aiLogger.info('AI mode enabled via socket request');
            io.emit('message', 'AI mode enabled, sending first image.');
            // socket.emit('aiModeEnabled', true);
            AIControlLoop.start()
            aimode = true

        } else {
            aiLogger.info('AI mode disabled via socket request');
            io.emit('message', 'AI mode disabled');
            // socket.emit('aiModeEnabled', false);
            AIControlLoop.stop()
            aimode = false
        }
    })

    socket.on('setGoal', (data) => {

        aiLogger.info(`New goal set via socket: ${data.goal}`);
        setGoal(data.goal); // set the goal in the AI control loop
        io.emit('message', `New goal set: ${data.goal}`); // send a message to the user
    })

    socket.on('requestLogs', () => {

        const logs = logCapture.getLogs();
        socket.emit('logs', logs);
    })

    socket.on('resetLogs', () => {

        logger.info('Log buffer reset on request');
        logCapture.clearLogs();
        socket.emit('logs', 'Logs cleared.');
    })

    socket.on('ollamaParamsPush', (params) => {
        setParams(params.movingParams);
        socket.broadcast.emit('ollamaParamsRelay', getParams()); // send the updated parameters to the user
    })

}) 


var typingtext = ''
AIControlLoop.on('responseComplete', (response) => {
    typingtext = '' // reset the typing text
    io.emit('userTypingRe', typingtext); // send the reset typing text to the user
    const message = typeof response === 'string' ? response.trim() : '';
    if (!message) return;
    io.emit('userMessageRe', {
        message,
        nickname: 'AI',
        userId: 'ai-control',
        timestamp: Date.now(),
        system: true,
    }); // send the response to the display
})

AIControlLoop.on('streamChunk', (chunk) => {
    io.emit('ollamaStreamChunk', chunk); // send the stream chunk to the user
    typingtext += chunk // append the chunk to the typing text
    io.emit('userTypingRe', typingtext); // send the stream chunk to the user as a typing indicator
})

AIControlLoop.on('controlLoopIteration', (iterationInfo) => {
    io.emit('controlLoopIteration', iterationInfo); // send the iteration count to the user
});

AIControlLoop.on('aiModeStatus', (status) => {
    aiLogger.info(`AI mode status changed: ${status}`);
    io.emit('aiModeEnabled', status); // send the AI mode status to the user
    if (status) {
        io.emit('message', 'AI mode enabled, sending first image.');
    } else {
        io.emit('message', 'AI mode disabled');
    }
});

AIControlLoop.on('goalSet', (goalText) => {
    aiLogger.debug(`AI control loop goal updated: ${goalText}`);
    io.emit('newGoal', goalText); // send the new goal to the user
});


logCapture.on('logEvent', () => {
    io.emit('logs', logCapture.getLogs()); 
})


// charging state packet id 21, 0 means not charging
// battery charge packet id 25
// battery capacity packet id 26


app.use(express.static('public'));


server.listen(webport, () => {
    logger.info(`Web server running on http://localhost:${webport}`);
    if (roverDisplay) {
        logger.info('Opening rover display');
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
                logger.error(`Error opening epiphany: ${error.message}`);
                return;
            }
            if (stderr) {
                logger.error(`Epiphany stderr: ${stderr}`);
                return;
            }
            logger.debug(`Epiphany stdout: ${stdout}`);
        });
    }
});
