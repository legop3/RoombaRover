
// Cache DOM elements once after the DOM is ready
const dom = {
oiMode: document.getElementById('oi-mode'),
dockStatus: document.getElementById('dock-status'),
chargeStatus: document.getElementById('charge-status'),
batteryUsage: document.getElementById('battery-usage'),
batteryVoltage: document.getElementById('battery-voltage'),
brushCurrent: document.getElementById('brush-current'),
batteryCurrent: document.getElementById('battery-current'),
bumpSensors: {
    L: document.getElementById('lightbump-L'),
    FL: document.getElementById('lightbump-FL'),
    CL: document.getElementById('lightbump-CL'),
    CR: document.getElementById('lightbump-CR'),
    FR: document.getElementById('lightbump-FR'),
    R: document.getElementById('lightbump-R')
},
leftCurrentBar: document.getElementById('leftCurrent-bar'),
rightCurrentBar: document.getElementById('rightCurrent-bar'),
startButtonMessage: document.getElementById('start-button-message'),
dockButtonMessage: document.getElementById('dock-button-message'),
dockButtonChargingMessage: document.getElementById('dock-button-charging-message'),
// wallSignal: document.getElementById('wall-distance')
};


var socket = io()

socket.on('auth-init', (message) => {

    console.log('not authenticated')
    //show login modal
    document.getElementById('password-form').classList.remove('hidden');

    const form = document.getElementById('password-form');
    const input = document.getElementById('password-input');
    input.focus()

    form.addEventListener('submit', (event) => {
        event.preventDefault()
        const password = input.value.trim()

        console.log(`attempting login ${password}`)

        if(password) {
            socket.auth = { token: password }
            socket.disconnect()
            socket.connect()

            document.getElementById('password-form').classList.add('hidden');

        }

    })


})



const player = new PCMPlayer({
    encoding: '16bitInt',
    channels: 1,
    sampleRate: 16000,
    flushTime: 20
});


socket.on('connect', () => {
    console.log('Connected to server')
    document.getElementById('connectstatus').innerText = 'Connected'
    document.getElementById('connectstatus').classList.remove('bg-red-500')
    document.getElementById('connectstatus').classList.add('bg-green-500')

    sensorData()
    startVideo()
    stopAudio()
    startAudio()

});
socket.on('disconnect', () => {
    console.log('Disconnected from server')
    document.getElementById('connectstatus').innerText = 'Disconnected'
    document.getElementById('connectstatus').classList.remove('bg-green-500')
    document.getElementById('connectstatus').classList.add('bg-red-500')
});

// key handler function
const pressedKeys = new Set();
function handleKeyEvent(event, isKeyDown) {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'shift', '\\'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        const speeds = keySpeedCalculator(pressedKeys);
        // console.log(`Left: ${speeds.leftSpeed}, Right: ${speeds.rightSpeed}`);
        socket.emit('Speedchange', speeds);
    }

    // key controls for side brush
    if (['o', 'l'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        if (pressedKeys.has('o')) speed = 127
        if (pressedKeys.has('l')) speed = -50
        if (!pressedKeys.has('o') && !pressedKeys.has('l')) speed = 0

        socket.emit('sideBrush', { speed: speed })

    } 

    //key controls for vacuum motor
    if (['i', 'k'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        if (pressedKeys.has('i')) speed = 127
        if (pressedKeys.has('k')) speed = 20
        if (!pressedKeys.has('i') && !pressedKeys.has('k')) speed = 0

        socket.emit('vacuumMotor', { speed: speed })

    }

    //press enter to start typing a message, then press enter again to send it
    // let inputFocused = false
    let sendButton = document.getElementById('sendMessageButton')
    let messageInput = document.getElementById('messageInput')
    if (['enter'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        if (document.activeElement === messageInput && isKeyDown) {
            sendButton.click()
            if (messageInput.value === '') {
                messageInput.blur()
            }
            messageInput.blur()
        } else if (document.activeElement !== messageInput && isKeyDown) {
            messageInput.focus()

        }
    }
}

document.addEventListener('keydown', e => handleKeyEvent(e, true));
document.addEventListener('keyup', e => handleKeyEvent(e, false));

function keySpeedCalculator(keys) {
    const baseSpeed = 100;
    const fast = 2.5, slow = 0.5;
    let left = 0, right = 0, mult = 1;
    if (keys.has('\\')) mult = fast;
    else if (keys.has('shift')) mult = slow;
    if (keys.has('w')) left += baseSpeed, right += baseSpeed;
    if (keys.has('s')) left -= baseSpeed, right -= baseSpeed;
    if (keys.has('a')) left -= baseSpeed, right += baseSpeed;
    if (keys.has('d')) left += baseSpeed, right -= baseSpeed;
    return { leftSpeed: left * mult, rightSpeed: right * mult };
}

function dockNow() { socket.emit('Docking', { action: 'dock' }); }
function reconnectRoomba() { socket.emit('Docking', { action: 'reconnect' }); }
function sensorData() { socket.emit('requestSensorData'); }
function startVideo() { socket.emit('startVideo'); }
function stopVideo() { socket.emit('stopVideo'); }
function startAudio() { socket.emit('startAudio'); }
function stopAudio() { socket.emit('stopAudio'); }
function sideBrush(state) { socket.emit('sideBrush', { action:state }); }

function easyStart() { socket.emit('easyStart'); }
function easyDock() { socket.emit('easyDock'); }

const dotblinker = document.getElementById('blinker');
dotblinker.classList.toggle('bg-red-500')
socket.on('videoFrame:frontCamera', data => {
    document.getElementById('video').src = 'data:image/jpeg;base64,' + data;       
    
    dotblinker.classList.toggle('bg-red-500')
    dotblinker.classList.toggle('bg-green-500')
});

socket.on('videoFrame:rearCamera', data => {
    document.getElementById('rearvideo').src = 'data:image/jpeg;base64,' + data;
})

socket.on('audio', base64 => {
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        player.feed(new Int16Array(bytes.buffer));
        player.flush();
    } catch (err) {
        console.error('Error processing audio:', err);
    }
});

sensorblinker = document.getElementById('sensorblinker');
sensorblinker.classList.toggle('bg-pink-400')


var MAX_VALUE = 300
var MAX_VALUE_WCURRENT = 800
socket.on('SensorData', data => {
    const chargeStatus = ['Not Charging', 'Reconditioning Charging', 'Full Charging', 'Trickle Charging', 'Waiting', 'Charging Error'][data.chargeStatus] || 'Unknown';
    const chargingSources = data.chargingSources === 2 ? 'Docked' : 'None';
    const oiMode = data.oiMode === 2 ? 'Passive' : (data.oiMode === 4 ? 'Full' : 'Safe');

    document.getElementById('oi-mode').innerText = `Mode: ${oiMode}`;
    document.getElementById('dock-status').innerText = `Dock: ${chargingSources}`;
    document.getElementById('charge-status').innerText = `Charging: ${chargeStatus}`;
    document.getElementById('battery-usage').innerText = `Charge: ${data.batteryCharge} / ${data.batteryCapacity}`;
    document.getElementById('battery-voltage').innerText = `Voltage: ${data.batteryVoltage / 1000}V`;
    document.getElementById('brush-current').innerText = `Brush: ${data.brushCurrent}mA`;
    document.getElementById('battery-current').innerText = `Current: ${data.batteryCurrent}mA`;

    updateBumpSensors(data.bumpSensors);

    // console.log(`motor currents: Left: ${data.leftCurrent}mA, Right: ${data.rightCurrent}mA`);

    // console.log('Wall signal:', data.wallSignal);
    // dom.wallSignal.style.width = `${(data.wallSignal / MAX_VALUE) * 100}%`;
    dom.leftCurrentBar.style.height = `${(data.leftCurrent / MAX_VALUE_WCURRENT) * 100}%`;
    dom.rightCurrentBar.style.height = `${(data.rightCurrent / MAX_VALUE_WCURRENT) * 100}%`;

    if(oiMode === 'Full') {
        dom.startButtonMessage.innerText = 'Ready to Drive!';
        dom.startButtonMessage.classList.remove('bg-red-500');
        dom.startButtonMessage.classList.add('bg-green-500');
    } else {
        dom.startButtonMessage.innerText = 'Not in Driving Mode!';
        dom.startButtonMessage.classList.remove('bg-green-500');
        dom.startButtonMessage.classList.add('bg-red-500');
    }

    if(chargingSources === 'Docked') {
        dom.dockButtonMessage.innerText = 'Docked!';
        dom.dockButtonMessage.classList.remove('bg-red-500');
        dom.dockButtonMessage.classList.add('bg-green-500');
        if(chargeStatus === 'Not Charging') {
            dom.dockButtonChargingMessage.innerText = 'Not Charging!';
            dom.dockButtonChargingMessage.classList.remove('bg-green-500');
            dom.dockButtonChargingMessage.classList.add('bg-red-500');
        } else {
            dom.dockButtonChargingMessage.innerText = chargeStatus;
            dom.dockButtonChargingMessage.classList.remove('bg-red-500');
            dom.dockButtonChargingMessage.classList.add('bg-green-500');
        }
    } else {
        dom.dockButtonMessage.innerText = 'Not Docked!';
        dom.dockButtonMessage.classList.remove('bg-green-500');
        dom.dockButtonMessage.classList.add('bg-red-500');
    }
    sensorblinker.classList.toggle('bg-pink-400')
    sensorblinker.classList.toggle('bg-black')
});


// Mapping of sensor index to DOM ID (same order as data.bumpSensors)
const bumpKeys = ['L', 'FL', 'CL', 'CR', 'FR', 'R'];
const bumpElements = bumpKeys.reduce((acc, key) => {
acc[key] = document.getElementById(`lightbump-${key}`);
return acc;
}, {});

// Range-based function to determine max value for scaling
function getMaxForRange(value) {
if (value < 100) return 100;
if (value < 500) return 500;
if (value < 1000) return 1000;
if (value < 1500) return 1500;
return 2000;
}

// Update bump sensor visuals based on their values
function updateBumpSensors(bumpValues) {
bumpKeys.forEach((key, index) => {
    const value = bumpValues[index];
    const el = bumpElements[key];

    // Use threshold-based scaling
    const max = getMaxForRange(value);
    const widthPercent = (value / max) * 100;
    const newColor = `hsl(${max / 2}, 100%, 50%)`;

    // Only update if the width would significantly change
    if (Math.abs(parseFloat(el.style.width || 0) - widthPercent) > 1) {
    el.style.width = `${widthPercent}%`;
    el.style.backgroundColor = newColor;
    }
});
}



socket.on('message', data => {
    document.getElementById('message').innerText = data;
    showToast(data, 'info')
});

socket.on('alert', data => {
    document.getElementById('message').innerText = data;
    showToast(data, 'error', false)
});

socket.on('ffmpeg', data => {
    document.getElementById('ffmpeg').innerText = data;
});

socket.on('ollamaEnabled', data => {
    console.log('ollama enabled:', data);
    document.getElementById('ollama-panel').classList.remove('hidden');
})


const ollamaText = document.getElementById('ollama-response-text');

socket.on('ollamaStreamChunk', data => {
    console.log('ollama stream chunk:', data);
    ollamaText.innerText += data;
    // showToast(data, 'info', false)
    ollamaText.scrollTop = ollamaText.scrollHeight; // Scroll to bottom
});

const ollamaStatus = document.getElementById('ollama-status');
const ollamaSpinner = document.getElementById('ai-spinner');

socket.on('controlLoopIteration', iterationInfo => {
    if (iterationInfo.status === 'started') {
        ollamaText.innerText = ''
        ollamaStatus.innerText = `Processing iteration ${iterationInfo.iterationCount}`;
        ollamaStatus.classList.remove('bg-red-500');
        ollamaStatus.classList.add('bg-blue-500');
        ollamaSpinner.classList.remove('hidden');
    } else if (iterationInfo.status === 'completed') {
        ollamaStatus.innerText = `Iteration ${iterationInfo.iterationCount} completed`;
        ollamaStatus.classList.remove('bg-blue-500');
        ollamaStatus.classList.add('bg-red-500');
        ollamaSpinner.classList.add('hidden');
    }
});


socket.on('aiModeEnabled', data => {
    console.log('AI mode enabled:', data);
    if(data){
        document.getElementById('ai-mode-status').innerText = 'Currently Enabled';
        document.getElementById('ai-mode-status').classList.remove('bg-red-500');
        document.getElementById('ai-mode-status').classList.add('bg-green-500');
    } else {
        document.getElementById('ai-mode-status').innerText = 'Currently Disabled';
        document.getElementById('ai-mode-status').classList.remove('bg-green-500');
        document.getElementById('ai-mode-status').classList.add('bg-red-500');

        ollamaStatus.innerText = 'Not Processing';
        ollamaStatus.classList.remove('bg-blue-500');
        ollamaStatus.classList.add('bg-red-500');

        ollamaSpinner.classList.add('hidden');
    }
})

socket.on('newGoal', goalText => {
    console.log('New goal received:', goalText);
    document.getElementById('goal-text').innerText = `Current Goal: ${goalText}`;
    // showToast(`New goal: ${goalText}`, 'info', false);
});

// Joystick control
const joystick = nipplejs.create({
    zone: document.getElementById('joystick'),
    mode: 'dynamic',
    // position: { left: '50%', top: '50%' },
    color: 'pink',
    size: '200'
});

// wheel speed calculations
const MAX_SPEED = 200
joystick.on('move', function (evt, data) {
    if (!data || !data.distance || !data.angle) return;
    let leftSpeed = data.vector.y * MAX_SPEED + data.vector.x * MAX_SPEED;
    let rightSpeed = data.vector.y * MAX_SPEED - data.vector.x * MAX_SPEED;

    leftSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, leftSpeed));
    rightSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, rightSpeed));

    leftSpeed = Math.round(leftSpeed);
    rightSpeed = Math.round(rightSpeed);

    // console.log(data.vector.x, data.vector.y);
    // console.log(`Left: ${leftSpeed}, Right: ${rightSpeed}`);
    socket.emit('Speedchange', { leftSpeed, rightSpeed });
});

joystick.on('end', function () {
    socket.emit('Speedchange', { leftSpeed: 0, rightSpeed: 0 });
});

function rebootServer() {
    const confirm = document.getElementById('rebootconfirm').checked;
    if (confirm) {
        socket.emit('rebootServer');
        document.getElementById('rebootconfirm').checked = false;
        alert("Rebooting Roomba's server. This will take a few minutes.");
    } else {
        alert("Please check the confirmation box to reboot the server.");
    }
}

// Stream your webcam stuff (WIP)
function sendFrame() {
    const video = document.getElementById('localcam');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.5);
    socket.emit('userWebcam', data);
}



async function startWebcam() {
    const video = document.getElementById('localcam');

    const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
    });
    video.srcObject = stream;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    setInterval(() => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.5);
        socket.emit('userWebcam', data);
        // console.log(data);
    }, 1000 / 2); 
}

function stopWebcam() {
    console.log('stopping webcam')
}



// send a message to the roomba screen
document.getElementById('sendMessageButton').addEventListener('click', () => {
    const message = document.getElementById('messageInput').value
    socket.emit('userMessage', { message, beep: document.getElementById('beepcheck').checked });
    document.getElementById('messageInput').value = '';
});

// send typing status to roomba screen
document.getElementById('messageInput').addEventListener('input', () => {
    const message = document.getElementById('messageInput').value
    socket.emit('userTyping', { message, beep: document.getElementById('beepcheck').checked });
});

// handle events from aux motor buttons on the joystick card
document.getElementById('brushForwardButton').addEventListener('pointerdown', () => {
    socket.emit('sideBrush', { speed: 127 });
})
document.getElementById('brushForwardButton').addEventListener('pointerup', () => {
    socket.emit('sideBrush', { speed: 0 });
})
document.getElementById('brushReverseButton').addEventListener('pointerdown', () => {
    socket.emit('sideBrush', { speed: -127 });
})
document.getElementById('brushReverseButton').addEventListener('pointerup', () => {
    socket.emit('sideBrush', { speed: 0 });
})
document.getElementById('vacuumMotorButton').addEventListener('pointerdown', () => {
    socket.emit('vacuumMotor', { speed: 127 });
})
document.getElementById('vacuumMotorButton').addEventListener('pointerup', () => {
    socket.emit('vacuumMotor', { speed: 0 });
})

document.getElementById('ai-start-button').addEventListener('click', () => {
    socket.emit('enableAIMode', { enabled: true });
});

document.getElementById('ai-stop-button').addEventListener('click', () => {
    socket.emit('enableAIMode', { enabled: false });
});