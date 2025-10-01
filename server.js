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
const accessControl = require('./publicMode');
const TurnManager = require('./turnManager');

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

const DRIVING_MODES = {
    ADMIN_ONLY: 'admin-only',
    TURNS: 'turns',
    OPEN_PLAY: 'open-play'
};

function resolveDefaultMode(mode) {
    const value = typeof mode === 'string' ? mode.toLowerCase() : '';
    return Object.values(DRIVING_MODES).includes(value) ? value : DRIVING_MODES.ADMIN_ONLY;
}

const defaultMode = resolveDefaultMode(config.accessControl?.defaultMode);
const defaultTurnDurationMs = Math.max(5000, (config.accessControl?.turns?.defaultDurationSeconds || 120) * 1000);
const defaultNoShowGraceMs = Math.max(1000, (config.accessControl?.turns?.noShowGraceSeconds || 7) * 1000);

const turnManager = new TurnManager(accessControl, {
    turnDurationMs: defaultTurnDurationMs,
    noShowGraceMs: defaultNoShowGraceMs
});

const viewerNamespace = io.of('/viewer');

let drivingMode = defaultMode;
const ADMIN_ALERT = 'Administrator privileges required.';

let clientsOnline = 0;

function broadcastUserCount() {
    io.emit('usercount', clientsOnline);
    viewerNamespace.emit('usercount', clientsOnline);
}

function broadcastAccessState() {
    io.emit('userlist', accessControl.list());
}

function broadcastDrivingMode() {
    const payload = {
        mode: drivingMode,
        turnDurationMs: turnManager.getDuration(),
        turnDurationSeconds: Math.round(turnManager.getDuration() / 1000),
        noShowGraceMs: turnManager.getNoShowGrace()
    };
    io.emit('driving-mode', payload);
    viewerNamespace.emit('driving-mode', payload);
}

function broadcastTurnState(state = turnManager.getState()) {
    io.emit('turns:state', state);
    viewerNamespace.emit('turns:state', state);
}

function sendSelfAccess(socket) {
    const record = accessControl.getSocket(socket.id);
    if (record) {
        socket.emit('access:self', {
            id: record.id,
            isAdmin: record.isAdmin,
            canDrive: record.canDrive
        });
    }
}

function ensureDriver(socket, callback) {
    if (accessControl.canDrive(socket.id)) {
        callback();
    } else {
        socket.emit('alert', authAlert);
    }
}

function ensureAdmin(socket, callback) {
    if (accessControl.isAdmin(socket.id)) {
        callback();
    } else {
        socket.emit('alert', ADMIN_ALERT);
    }
}

function applyDrivingMode(mode) {
    const normalized = resolveDefaultMode(mode);
    if (drivingMode === normalized) {
        return false;
    }

    drivingMode = normalized;

    if (drivingMode === DRIVING_MODES.ADMIN_ONLY) {
        turnManager.stop();
        accessControl.setDrivingForAllNonAdmins(false);
    } else if (drivingMode === DRIVING_MODES.OPEN_PLAY) {
        turnManager.stop();
        accessControl.setDrivingForAllNonAdmins(true);
    } else if (drivingMode === DRIVING_MODES.TURNS) {
        accessControl.setDrivingForAllNonAdmins(false);
        turnManager.start();
    }

    broadcastDrivingMode();
    broadcastAccessState();
    broadcastTurnState();
    return true;
}

accessControl.on('registered', () => {
    broadcastAccessState();
});

accessControl.on('unregistered', () => {
    broadcastAccessState();
});

accessControl.on('driverAccessChanged', ({ socketId, canDrive }) => {
    const record = accessControl.getSocket(socketId);
    if (record?.socket) {
        record.socket.emit('driving-access', canDrive);
        sendSelfAccess(record.socket);
    }
    broadcastAccessState();
});

turnManager.on('state', (state) => {
    broadcastTurnState(state);
});

turnManager.on('turnStarted', ({ socketId }) => {
    const record = accessControl.getSocket(socketId);
    if (record?.socket) {
        record.socket.emit('turns:your-turn', {
            socketId,
            durationMs: turnManager.getDuration()
        });
    }
});

turnManager.on('turnEnded', ({ turn, reason }) => {
    driveDirect(0, 0);
    const record = accessControl.getSocket(turn.socketId);
    if (record?.socket) {
        record.socket.emit('turns:ended', { reason });
    }
});

applyDrivingMode(drivingMode);

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
        const sensorPayload = {
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
        };
        io.emit('SensorData', sensorPayload);
        viewerNamespace.emit('SensorData', sensorPayload);


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

        roombaStatus.overcurrents = overcurrents

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
    const token = socket.handshake?.auth?.token;
    socket.data = socket.data || {};
    socket.data.isAdmin = Boolean(token && token === config.accessControl.adminPassword);
    next();
})






// socket listening stuff
let sensorPoll = null;


io.on('connection', async (socket) => {
    console.log('a user connected');

    const isAdmin = Boolean(socket.data?.isAdmin);
    const record = accessControl.registerSocket(socket, { isAdmin });

    clientsOnline++;
    broadcastUserCount();
    broadcastAccessState();
    broadcastDrivingMode();
    socket.emit('driving-access', record.canDrive);
    sendSelfAccess(socket);
    socket.emit('turns:state', turnManager.getState());
    socket.emit('ollamaParamsRelay', getParams());

    if (config.ollama.enabled) {
        socket.emit('ollamaEnabled', true);
        socket.emit('aiModeEnabled', aimode);
    }

    if (!isAdmin) {
        if (drivingMode === DRIVING_MODES.OPEN_PLAY) {
            accessControl.setDrivingAllowed(socket.id, true);
        } else if (drivingMode === DRIVING_MODES.TURNS) {
            turnManager.enqueue(socket.id);
        } else {
            accessControl.setDrivingAllowed(socket.id, false);
        }
    }

    socket.on('disconnect', () => {
        console.log('user disconnected');
        turnManager.remove(socket.id);
        accessControl.unregisterSocket(socket.id);
        clientsOnline = Math.max(0, clientsOnline - 1);
        broadcastUserCount();
        broadcastAccessState();
        driveDirect(0, 0);
    });

    socket.on('Speedchange', (data) => {
        ensureDriver(socket, () => {
            driveDirect(data.rightSpeed, data.leftSpeed);
            turnManager.markActivity(socket.id);
        });
    });

    socket.on('Docking', (data) => {
        ensureDriver(socket, () => {
            if (data.action === 'dock') {
                tryWrite(port, [143]);
            }

            if (data.action === 'reconnect') {
                tryWrite(port, [128]);
                tryWrite(port, [132]);
            }
        });
    });

    socket.on('requestSensorData', () => {
        console.log('Sensor data start requested');

        function getSensorData() {
            tryWrite(port, [149, 25, 21, 25, 26, 34, 35, 22, 57, 23, 46, 47, 48, 49, 50, 51, 27, 55, 54, 7, 28, 29, 30, 31, 15, 56, 14]);
        }

        if (!sensorPoll) {
            console.log('Starting sensor data polling');
            sensorPoll = setInterval(getSensorData, 60);
            io.emit('message', 'Sensor data polling started');
        } else {
            console.log('Sensor data already being polled');
            clearInterval(sensorPoll);
            sensorPoll = null;
            console.log('Restarting sensor data polling');
            sensorPoll = setInterval(getSensorData, 60);
            io.emit('message', 'Sensor data polling restarted');
        }
    });

    socket.on('startVideo', () => {
        frontCameraStream.start();
        if (config.rearCamera.enabled) {
            // Rear camera hook placeholder
        }
    });

    socket.on('stopVideo', () => {
        ensureAdmin(socket, () => {
            frontCameraStream.stop();
            spawn('sudo', ['usbreset', config.camera.USBAddress]);

            if (config.rearCamera.enabled) {
                spawn('sudo', ['usbreset', config.rearCamera.USBAddress]);
            }
        });
    });

    let mainBrushSave = 0;
    let sideBrushSave = 0;
    let vacuumMotorSave = 0;

    function auxMotorSpeeds(mainBrush, sideBrush, vacuumMotor) {
        try {
            if (mainBrush !== undefined && mainBrush !== null) {
                mainBrushSave = mainBrush;
            }
            if (sideBrush !== undefined && sideBrush !== null) {
                sideBrushSave = sideBrush;
            }
            if (vacuumMotor !== undefined && vacuumMotor !== null) {
                vacuumMotorSave = vacuumMotor;
            }
        } catch (e) {
            // ignore
        }

        tryWrite(port, [144, mainBrushSave, sideBrushSave, vacuumMotorSave]);
        console.log('Aux motors: ', mainBrushSave, sideBrushSave, vacuumMotorSave);
    }

    socket.on('sideBrush', (data) => {
        ensureDriver(socket, () => {
            auxMotorSpeeds(undefined, data.speed, undefined);
            turnManager.markActivity(socket.id);
        });
    });

    socket.on('vacuumMotor', (data) => {
        ensureDriver(socket, () => {
            auxMotorSpeeds(undefined, undefined, data.speed);
            turnManager.markActivity(socket.id);
        });
    });

    socket.on('brushMotor', (data) => {
        ensureDriver(socket, () => {
            auxMotorSpeeds(data.speed, undefined, undefined);
            turnManager.markActivity(socket.id);
        });
    });

    socket.on('startAudio', () => {
        console.log('Audio stream started');
        startAudioStream();
    });

    socket.on('stopAudio', () => {
        ensureAdmin(socket, () => {
            console.log('Audio stream stopped');
            stopAudioStream();
        });
    });

    socket.on('rebootServer', () => {
        ensureAdmin(socket, () => {
            console.log('reboot requested');
            spawn('sudo', ['reboot']);
        });
    });

    socket.on('userWebcam', (data) => {
        ensureDriver(socket, () => {
            io.emit('userWebcamRe', data);
            viewerNamespace.emit('userWebcamRe', data);
        });
    });

    socket.on('userMessage', (data) => {
        ensureDriver(socket, () => {
            if (data.beep) {
                playRoombaSong(port, 0, [[60, 15]]);
                speak(data.message);
            }
            io.emit('userMessageRe', data.message);
            viewerNamespace.emit('userMessageRe', data.message);
        });
    });

    socket.on('userTyping', (data) => {
        ensureDriver(socket, () => {
            if (data.beep && data.message.length === 1) {
                playRoombaSong(port, 1, [[58, 15]]);
            }
            io.emit('userTypingRe', data.message);
            viewerNamespace.emit('userTypingRe', data.message);
        });
    });

    socket.on('wallFollowMode', (data) => {
        ensureDriver(socket, () => {
            if (data.enable) {
                console.log('enabling wall following!!');
                console.log('jk!! this doesnt exist!');
            }
        });
    });

    socket.on('easyStart', () => {
        ensureAdmin(socket, () => {
            console.log('initiating easy start');
            tryWrite(port, [143]);
            tryWrite(port, [132]);
            AIControlLoop.stop();
        });
    });

    socket.on('easyDock', () => {
        ensureAdmin(socket, () => {
            console.log('initating easy dock');
            tryWrite(port, [143]);
        });
    });

    socket.on('enableAIMode', (data) => {
        ensureAdmin(socket, () => {
            if (data.enabled) {
                console.log('enabling AI mode');
                io.emit('message', 'AI mode enabled, sending first image.');
                AIControlLoop.start();
                aimode = true;
            } else {
                console.log('disabling AI mode');
                io.emit('message', 'AI mode disabled');
                AIControlLoop.stop();
                aimode = false;
            }
        });
    });

    socket.on('setGoal', (data) => {
        ensureAdmin(socket, () => {
            console.log('setting new goal:', data.goal);
            setGoal(data.goal);
            io.emit('message', `New goal set: ${data.goal}`);
        });
    });

    socket.on('requestLogs', () => {
        ensureAdmin(socket, () => {
            const logs = logCapture.getLogs();
            socket.emit('logs', logs);
        });
    });

    socket.on('resetLogs', () => {
        ensureAdmin(socket, () => {
            console.log('resetting logs');
            logCapture.clearLogs();
            socket.emit('logs', 'Logs cleared.');
        });
    });

    socket.on('ollamaParamsPush', (params) => {
        ensureAdmin(socket, () => {
            setParams(params.movingParams);
            socket.broadcast.emit('ollamaParamsRelay', getParams());
        });
    });

    socket.on('driving-mode:set', (mode) => {
        ensureAdmin(socket, () => {
            applyDrivingMode(mode);
        });
    });

    socket.on('access:set-driving', ({ socketId, canDrive }) => {
        ensureAdmin(socket, () => {
            if (!socketId || accessControl.isAdmin(socketId)) {
                return;
            }

            accessControl.setDrivingAllowed(socketId, canDrive);

            if (drivingMode === DRIVING_MODES.TURNS) {
                if (canDrive) {
                    turnManager.enqueue(socketId);
                } else {
                    turnManager.remove(socketId);
                }
            }
        });
    });

    socket.on('turns:set-duration', ({ seconds }) => {
        ensureAdmin(socket, () => {
            const durationMs = Math.max(5000, Number(seconds) * 1000 || 0);
            turnManager.setDuration(durationMs);
            broadcastDrivingMode();
        });
    });

    socket.on('turns:skip', () => {
        ensureAdmin(socket, () => {
            turnManager.skipCurrentTurn();
        });
    });

    socket.on('turns:no-show', () => {
        turnManager.handleNoShow(socket.id);
    });
});

var typingtext = ''
AIControlLoop.on('responseComplete', (response) => {
    // console.log('full ollama response from main: ', response)
    typingtext = '' // reset the typing text
    io.emit('userTypingRe', typingtext); // send the reset typing text to the user
    viewerNamespace.emit('userTypingRe', typingtext);
    io.emit('userMessageRe', response); // send the response to the display
    viewerNamespace.emit('userMessageRe', response);
})

AIControlLoop.on('streamChunk', (chunk) => {
    // console.log(chunk)
    io.emit('ollamaStreamChunk', chunk); // send the stream chunk to the user
    typingtext += chunk // append the chunk to the typing text
    io.emit('userTypingRe', typingtext); // send the stream chunk to the user as a typing indicator
    viewerNamespace.emit('userTypingRe', typingtext);
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

