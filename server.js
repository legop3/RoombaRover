const logCapture = require('./logCapture')
const { SerialPort } = require('serialport'); 

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
var config = require('./config.json'); // Load configuration from config.json
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

const turnHandler = require('./turnHandler');

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
        console.error('Failed to broadcast user list', error);
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


const BATTERY_LOW_PERCENT_THRESHOLD = 80;
const BATTERY_LOW_VOLTAGE_THRESHOLD = 13_500;
const BATTERY_RECOVER_PERCENT_THRESHOLD = 98;
const BATTERY_RECOVER_VOLTAGE_THRESHOLD = 15_200;
const BATTERY_ALERT_COOLDOWN_MS = 10 * 60_000;
const DOCK_REMINDER_INTERVAL_MS = 2 * 60_000;

const batteryManagementState = {
    needsCharge: false,
    lastAlertAt: 0,
    lastDockReminderAt: 0,
    lastResumeNoticeAt: 0,
    chargingPauseNotified: false,
};


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
    console.log('Port is open. Ready to go...');

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
            cliffSensors,
            mainBrushCurrent,
            dirtDetect,
            overcurrents
        });


        roombaStatus.docked = (chargingSources === 2)
        roombaStatus.chargeStatus = (chargeStatus != 0 && chargeStatus != 5)
        roombaStatus.batteryCharge = batteryCharge
        roombaStatus.batteryCapacity = batteryCapacity
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

        roombaStatus.overcurrents = overcurrents

        const computedPercentage = batteryCapacity > 0 ? Math.round((batteryCharge / batteryCapacity) * 100) : 0;
        roombaStatus.batteryPercentage = Math.max(0, Math.min(100, computedPercentage));
        console.log('battery pct:', roombaStatus.batteryPercentage);

        updateBatteryManagement();



        
 
        
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



// socket listening stuff
let sensorPoll = null;
let clientsOnline = 0;

const viewerspace = io.of('/viewer');
viewerspace.on('connection', (socket) => {
    console.log('a viewer connected');
    viewerspace.emit('usercount', clientsOnline);

});

io.on('connection', async (socket) => {

    socket.nickname = generateDefaultNickname(socket.id);
    socket.emit('nickname:update', { userId: socket.id, nickname: socket.nickname });

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

    console.log('a user connected');
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
        console.log('gmode ', accessControlState.mode)
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
        console.log('user disconnected')
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


            console.log('Sensor data start requested')

            function getSensorData() {
                // query charging, battery charge, battery capacity, charging sources, OI mode, battrey voltage, side brush current, wall signal sensors, right motor current, left motor current, bumps, wheel drops, dirt detect, wheel overcurrents
                tryWrite(port, [149, 25, 21, 25, 26, 34, 35, 22, 57, 23, 46, 47, 48, 49, 50, 51, 27, 55, 54, 7, 28, 29, 30, 31, 15, 56, 14]); 
            }

            if (!sensorPoll) {
                console.log('Starting sensor data polling');
                sensorPoll = setInterval(getSensorData, 60); // poll every 60ms
                io.emit('message', 'Sensor data polling started');
            } else {
                console.log('Sensor data already being polled');
                clearInterval(sensorPoll);
                sensorPoll = null;
                console.log('Restarting sensor data polling');
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
        console.log('Audio stream started');
        startAudioStream();
    });
    socket.on('stopAudio', () => {


        console.log('Audio stream stopped');
        stopAudioStream();
        // Stop audio stream here
    });

    socket.on('rebootServer', () => {
        if(!socket.isAdmin) return


        console.log('reboot requested')
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
            console.log('beep')
            speak(message) // speak the message
        }
        viewerspace.emit('userMessageRe', payload);
        io.emit('userMessageRe', payload);
    })

    socket.on('userTyping', (data) => {
        if(data.beep) {
            if (data.message.length === 1) {
                playRoombaSong(port, 1, [[58, 15]]);
                console.log('typing beep')
            }
        }
        viewerspace.emit('userTypingRe', data.message);
    })

    socket.on('wallFollowMode', (data) => {


        if (data.enable) {
            console.log('enabling wall following!!')
            console.log('jk!! this doesnt exist!')

        } else {

        }
    })



    socket.on('easyStart', () => {


        console.log('initiating easy start')
        // send dock message then start message, kinda janky but might work
        // turns out it does work!!
        tryWrite(port, [143])

        tryWrite(port, [132])


        AIControlLoop.stop()
    })

    socket.on('easyDock', () => {

        console.log('initating easy dock')
        tryWrite(port, [143])

    })
    socket.on('enableAIMode', (data) => {

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

        console.log('setting new goal:', data.goal)
        setGoal(data.goal); // set the goal in the AI control loop
        io.emit('message', `New goal set: ${data.goal}`); // send a message to the user
    })

    socket.on('requestLogs', () => {

        const logs = logCapture.getLogs();
        socket.emit('logs', logs);
    })

    socket.on('resetLogs', () => {

        console.log('resetting logs')
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

function formatBatterySummary(percent, voltage) {
    const voltageDisplay = Number.isFinite(voltage) ? (voltage / 1000).toFixed(2) : '0.00';
    const percentDisplay = Number.isFinite(percent) ? percent : 0;
    return `${percentDisplay}% / ${voltageDisplay}V`;
}

function notifyBatteryLow(percent, voltage) {
    const summary = formatBatterySummary(percent, voltage);
    const message = `Battery low (${summary}). Please dock the rover to charge.`;
    console.log('[BatteryMgr] Low battery detected:', summary);
    io.emit('alert', message);
    io.emit('message', message);

    if (config.discordBot?.enabled && typeof alertAdmins === 'function') {
        console.log('[BatteryMgr] Notifying Discord admins about low battery.');
        alertAdmins(`[Roomba Rover] ${message}`).catch((error) => {
            console.error('Failed to alert Discord admins about low battery:', error);
        });
    }
}

function notifyChargingPause(percent, voltage, turnsModeActive) {
    const summary = formatBatterySummary(percent, voltage);
    const message = turnsModeActive
        ? `Battery charging (${summary}). Turns are paused until charging completes.`
        : `Battery charging (${summary}). Please keep the rover docked until it finishes.`;
    console.log('[BatteryMgr] Charging detected:', summary, '| turns mode active:', turnsModeActive);
    io.emit('alert', message);
    io.emit('message', message);
}

function notifyDockReminder(percent, voltage) {
    const summary = formatBatterySummary(percent, voltage);
    const message = `Battery still low (${summary}). Please dock the rover as soon as possible.`;
    console.log('[BatteryMgr] Dock reminder triggered:', summary);
    io.emit('alert', message);
    io.emit('message', message);
}

function notifyBatteryRecovered(percent, voltage, turnsModeActive) {
    const summary = formatBatterySummary(percent, voltage);
    const message = turnsModeActive
        ? `Battery recovered (${summary}). Turns have resumed.`
        : `Battery recovered (${summary}).`;
    console.log('[BatteryMgr] Battery recovered:', summary, '| turns mode active:', turnsModeActive);
    io.emit('alert', message);
    io.emit('message', message);
}

function updateBatteryManagement() {
    const now = Date.now();
    const percent = Number.isFinite(roombaStatus.batteryPercentage) ? roombaStatus.batteryPercentage : 0;
    const voltage = Number.isFinite(roombaStatus.batteryVoltage) ? roombaStatus.batteryVoltage : 0;

    const lowPercent = percent <= BATTERY_LOW_PERCENT_THRESHOLD;
    const lowVoltage = voltage > 0 && voltage <= BATTERY_LOW_VOLTAGE_THRESHOLD;
    const needsCharge = lowPercent || lowVoltage;

    if (needsCharge && !batteryManagementState.needsCharge) {
        batteryManagementState.needsCharge = true;
        batteryManagementState.lastAlertAt = now;
        batteryManagementState.lastDockReminderAt = now;
        batteryManagementState.chargingPauseNotified = false;
        console.log('[BatteryMgr] Entering low battery state. percent:', percent, 'voltage:', voltage);
        notifyBatteryLow(percent, voltage);
    } else if (needsCharge && now - batteryManagementState.lastAlertAt > BATTERY_ALERT_COOLDOWN_MS) {
        batteryManagementState.lastAlertAt = now;
        console.log('[BatteryMgr] Low battery cooldown elapsed, re-alerting. percent:', percent, 'voltage:', voltage);
        notifyBatteryLow(percent, voltage);
    }

    if (!needsCharge) {
        const recoveredPercent = percent >= BATTERY_RECOVER_PERCENT_THRESHOLD;
        const recoveredVoltage = voltage >= BATTERY_RECOVER_VOLTAGE_THRESHOLD;
        const recovered = recoveredPercent && recoveredVoltage;

        if (batteryManagementState.needsCharge) {
            if (recovered) {
                batteryManagementState.needsCharge = false;
                batteryManagementState.chargingPauseNotified = false;
                batteryManagementState.lastResumeNoticeAt = now;
                console.log('[BatteryMgr] Battery recovered above thresholds. percent:', percent, 'voltage:', voltage);
                notifyBatteryRecovered(percent, voltage, accessControlState?.mode === 'turns');
                if (turnHandler.isChargingPauseActive()) {
                    console.log('[BatteryMgr] Clearing turn pause after recovery.');
                    turnHandler.clearChargingPause();
                }
            }
            return;
        }

        if (turnHandler.isChargingPauseActive()) {
            console.log('[BatteryMgr] Clearing stale turn pause (no longer needs charge).');
            turnHandler.clearChargingPause();
        }

        return;
    }

    if (batteryManagementState.needsCharge) {
        if (roombaStatus.docked && roombaStatus.chargeStatus) {
            const turnsModeActive = accessControlState?.mode === 'turns';

            if (turnsModeActive && !turnHandler.isChargingPauseActive()) {
                console.log('[BatteryMgr] Docked & charging in turns mode. Pausing queue.');
                turnHandler.setChargingPause('battery-charging');
            }

            if (!batteryManagementState.chargingPauseNotified) {
                console.log('[BatteryMgr] Announcing charging pause. percent:', percent, 'voltage:', voltage);
                notifyChargingPause(percent, voltage, turnsModeActive);
                batteryManagementState.chargingPauseNotified = true;
            }
        } else {
            if (turnHandler.isChargingPauseActive()) {
                console.log('[BatteryMgr] Rover not charging; clearing turn pause.');
                turnHandler.clearChargingPause();
            }

            if (now - batteryManagementState.lastDockReminderAt > DOCK_REMINDER_INTERVAL_MS) {
                batteryManagementState.lastDockReminderAt = now;
                notifyDockReminder(percent, voltage);
            }

            batteryManagementState.chargingPauseNotified = false;
        }
    }
}

let alarming = false
function batteryAlarm() {
    const shouldAlarm = batteryManagementState.needsCharge && !roombaStatus.docked;

    if (shouldAlarm && !alarming) {
        console.log('[BatteryMgr] Playing low-battery tone.');
        playRoombaSong(port, 0, [[78, 15]]);
    }

    alarming = shouldAlarm;
}

setInterval(batteryAlarm, 5_000)


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
