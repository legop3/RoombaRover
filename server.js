const logCapture = require('./services/logCapture')
const { createLogger, setLogLevel } = require('./helpers/logger');

const logger = createLogger('Server');
const socketLogger = logger.child('Socket');
const audioLogger = logger.child('Audio');
const commandLogger = logger.child('Command');
const aiLogger = logger.child('AI');

// ross is goated

const { app, server, io, wss } = require('./globals/wsSocketExpress');
const { buildUiConfig } = require('./services/uiConfig');

io.use((socket, next) => {
    if (!socket.nickname) {
        socket.nickname = generateDefaultNickname(socket.id);
    }
    next();
});

const { spawn, exec } = require('child_process');
var config = require('./helpers/config'); // Load configuration from config.yaml

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

const { CameraStream } = require('./helpers/CameraStream')
const accessControl = require('./services/accessControl');
const { startDiscordBot, alertAdmins } = require('./services/discordBot');

const { port, tryWrite } = require('./globals/serialConnection');
const { driveDirect, playRoombaSong } = require('./helpers/roombaCommands');
const { AIControlLoop, setGoal, speak, setParams, getParams } = require('./services/ollama');
const roombaStatus = require('./globals/roombaStatus')
const batteryManager = require('./services/batteryManager');
const { createSensorService } = require('./services/sensorService');

const turnHandler = require('./services/turnHandler');

require('./services/roomCamera');
require('./services/homeAssistantLights');
require('./services/ftdiGpio');
require('./controls/roverDriving');

const random_word = require('all-random-words');





function generateDefaultNickname(socketId) {
    // const suffix = typeof socketId === 'string' && socketId.length >= 4
    //     ? socketId.slice(-4)
    //     : Math.random().toString(36).slice(-4);
    // return `User ${suffix}`;
    // return random_word(1);
    // return 'test';
    let name = random_word();
    // logger.info(`name ${name}`)
    return name;

}

const EVENT_ALLOWED_WHEN_NOT_DRIVING = new Set(['setNickname', 'userMessage', 'userTyping', 'set-spectate-mode', 'light_switch']);

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

const sensorService = createSensorService({
    io,
    batteryManager,
    roombaStatus,
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
        // spectatespace.emit('audio', data);
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
let clientsOnline = 0;

const viewerspace = io.of('/viewer');
viewerspace.on('connection', (socket) => {
    socketLogger.debug(`Viewer connected: ${socket.id}`);
    viewerspace.emit('usercount', clientsOnline);
});

const spectatespace = io.of('/spectate');
spectatespace.on('connection', (socket) => {
    broadcastUserList();
    if(accessControlState.mode === 'lockdown') {
        socket.emit('disconnect-reason', 'LOCKDOWN_ENABLED');
        return socket.disconnect(true);
    }
    socketLogger.debug(`Spectator connected: ${socket.id}`);
    viewerspace.emit('usercount', clientsOnline);
});


// SPECTATOR EVENT FORWARDER
function forwardToSpectators(eventName, ...args) {
    spectatespace.emit(eventName, ...args);
    viewerspace.emit(eventName, ...args);
}

// Monkey-patch io.emit to forward all events except internal ones
const INTERNAL_EVENTS = new Set(['connection', 'disconnect', 'disconnecting', 'newListener', 'removeListener']);
const originalEmit = io.emit.bind(io);
io.emit = function(event, ...args) {
    if (!INTERNAL_EVENTS.has(event)) {
        forwardToSpectators(event, ...args);
    }
    return originalEmit(event, ...args);
};

io.on('connection', async (socket) => {

    socket.nickname = generateDefaultNickname(socket.id);
    socket.emit('nickname:update', { userId: socket.id, nickname: socket.nickname });
    // socket.emit('ui-config', buildUiConfig());

    socket.use((packet, next) => {
        const eventName = Array.isArray(packet) ? packet[0] : undefined;
        if (EVENT_ALLOWED_WHEN_NOT_DRIVING.has(eventName)) {
            return next();
        }
        if (socket.driving || socket.isAdmin) {
            return next();
        }
        socket.emit('alert', 'You are not currently driving.');
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
//     socket.on('Speedchange', (data) => {
// //         if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!


//         // console.log(data)
//         socket.lastDriveCommandAt = Date.now();
//         roombaStatus.lastDriveCommandAt = socket.lastDriveCommandAt;
//         driveDirect(data.rightSpeed, data.leftSpeed);

//     });

    // stop driving on socket disconnect
    socket.on('disconnect', async () => {
        socketLogger.info(`User disconnected: ${socket.id}`);
        clientsOnline --
        io.emit('usercount', clientsOnline -1);
        await broadcastUserList();
        driveDirect(0, 0);

    });

    // handle docking and reinit commands
//     socket.on('Docking', (data) => {
// //         if(!socket.authenticated) return socket.emit('alert', authAlert) // private event!! auth only!!



//         if (data.action == 'dock') {
//             tryWrite(port, [143]); // Dock command
//         }

//         if (data.action == 'reconnect') {
//             tryWrite(port, [128]); 
//             tryWrite(port, [132]); 
//         }
//     })

    socket.on('requestSensorData', () => {
        sensorService.startPolling();
    });


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

    wss.on('connection', (ws) => {
        logger.info('Video stream client connected');
        frontCameraStream.addClient(ws);

        ws.on('close', () => {
            logger.info('Video stream client disconnected');
            // rearCameraStream.removeClient(ws);
        });
    });

    socket.on('stopVideo', () => {
        if (!socket.isAdmin) return

        frontCameraStream.stop()

        spawn('sudo', ['usbreset', config.camera.USBAddress]); 

        if(config.rearCamera.enabled) {
            spawn('sudo', ['usbreset', config.rearCamera.USBAddress]);
        }

    });



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



    // AI MODE STUFFS
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
