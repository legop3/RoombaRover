
// Cache DOM elements once after the DOM is ready
const dom = {
oiMode: document.getElementById('oi-mode'),
dockStatus: document.getElementById('dock-status'),
chargeStatus: document.getElementById('charge-status'),
batteryUsage: document.getElementById('battery-usage'),
batteryVoltage: document.getElementById('battery-voltage'),
    brushCurrent: document.getElementById('brush-current'),
    batteryCurrent: document.getElementById('battery-current'),
    cpuUsage: document.getElementById('cpu-usage'),
    memoryUsage: document.getElementById('memory-usage'),
    bumpSensors: {
        L: document.getElementById('lightbump-L'),
        FL: document.getElementById('lightbump-FL'),
        CL: document.getElementById('lightbump-CL'),
        CR: document.getElementById('lightbump-CR'),
    FR: document.getElementById('lightbump-FR'),
    R: document.getElementById('lightbump-R')
},
cliffSensors: {
    L: document.getElementById('cliff-L'),
    FL: document.getElementById('cliff-FL'),
    FR: document.getElementById('cliff-FR'),
    R: document.getElementById('cliff-R'),
},
leftCurrentBar: document.getElementById('leftCurrent-bar'),
rightCurrentBar: document.getElementById('rightCurrent-bar'),
startButtonMessage: document.getElementById('start-button-message'),
dockButtonMessage: document.getElementById('dock-button-message'),
dockButtonChargingMessage: document.getElementById('dock-button-charging-message'),
bumpLeft: document.getElementById('bump-left'),
bumpRight: document.getElementById('bump-right'),
dropLeft: document.getElementById('drop-left'),
dropRight: document.getElementById('drop-right'),
    userCount: document.getElementById('user-counter'),
    mainBrushCurrent: document.getElementById('main-brush-current'),
    dirtDetect: document.getElementById('dirt-detect'),
    overcurrentWarning: document.getElementById('overcurrent-warning'),
    overcurrentStatus: document.getElementById('overcurrent-status'),
    discordChannelSelect: document.getElementById('discord-channel-select'),
    discordClipStatus: document.getElementById('discord-clip-status'),
    discordClipButton: document.getElementById('discord-clip-button'),
    discordRefreshButton: document.getElementById('discord-refresh-button'),
// wallSignal: document.getElementById('wall-distance')
};


var socket = io()

const discordChannelMap = new Map();

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

    if (dom.discordChannelSelect) {
        requestDiscordChannels();
    }

    // Find your image element
    const cameraImg = document.getElementById('front-camera'); // or whatever your img id is

    if (cameraImg) {
        // Add timestamp to force reload
        const currentSrc = cameraImg.src.split('?')[0]; // Remove existing params
        cameraImg.src = currentSrc + '?t=' + Date.now();
    }
    

});
socket.on('disconnect', () => {
    console.log('Disconnected from server')
    document.getElementById('connectstatus').innerText = 'Disconnected'
    document.getElementById('connectstatus').classList.remove('bg-green-500')
    document.getElementById('connectstatus').classList.add('bg-red-500')
});

socket.on('system-stats', data => {
    dom.cpuUsage.textContent = `CPU: ${data.cpu}%`;
    dom.memoryUsage.textContent = `RAM: ${data.memory}%`;
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

    // key controls for brush motor
    if (['p', ';'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;
        if (pressedKeys.has('p')) speed = 127
        if (pressedKeys.has(';')) speed = -50
        if (!pressedKeys.has('p') && !pressedKeys.has(';')) speed = 0

        socket.emit('brushMotor', { speed: speed })
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
function requestDiscordChannels() {
    if (!dom.discordChannelSelect) return;
    socket.emit('requestDiscordChannels');
    dom.discordChannelSelect.disabled = true;
    if (dom.discordClipButton) dom.discordClipButton.disabled = true;
    if (dom.discordRefreshButton) dom.discordRefreshButton.disabled = true;
    if (dom.discordClipStatus) dom.discordClipStatus.textContent = 'Checking Discord...';
}
function sendDiscordClip() {
    if (!dom.discordChannelSelect) return;
    const channelId = dom.discordChannelSelect.value;
    if (!channelId) {
        const message = 'Choose a Discord channel first.';
        if (dom.discordClipStatus) dom.discordClipStatus.textContent = message;
        showToast(message, 'warning');
        return;
    }

    if (dom.discordClipButton) dom.discordClipButton.disabled = true;
    if (dom.discordRefreshButton) dom.discordRefreshButton.disabled = true;
    dom.discordChannelSelect.disabled = true;
    if (dom.discordClipStatus) dom.discordClipStatus.textContent = 'Summoning the camera for Discord...';

    socket.emit('recordDiscordClip', { channelId });
}
function sideBrush(state) { socket.emit('sideBrush', { action:state }); }

function easyStart() { socket.emit('easyStart'); }
function easyDock() { socket.emit('easyDock'); }

const dotblinker = document.getElementById('blinker');
dotblinker.classList.toggle('bg-red-500')

// Track object URLs so they can be revoked and avoid memory leaks
let frontVideoUrl = null;
let rearVideoUrl = null;

socket.on('videoFrame:frontCamera', data => {
    const blob = new Blob([data], { type: 'image/jpeg' });
    if (frontVideoUrl) URL.revokeObjectURL(frontVideoUrl);
    frontVideoUrl = URL.createObjectURL(blob);
    document.getElementById('video').src = frontVideoUrl;

    dotblinker.classList.toggle('bg-red-500')
    dotblinker.classList.toggle('bg-green-500')
});

socket.on('videoFrame:rearCamera', data => {
    const blob = new Blob([data], { type: 'image/jpeg' });
    if (rearVideoUrl) URL.revokeObjectURL(rearVideoUrl);
    rearVideoUrl = URL.createObjectURL(blob);
    document.getElementById('rearvideo').src = rearVideoUrl;
})

// socket.on('videoFrame', () => {
//     dotblinker.classList.toggle('bg-red-500')
//     dotblinker.classList.toggle('bg-green-500')
// })

socket.on('audio', chunk => {
    try {
        player.feed(new Int16Array(chunk));
        player.flush();
    } catch (err) {
        console.error('Error processing audio:', err);
    }
});

sensorblinker = document.getElementById('sensorblinker');
sensorblinker.classList.toggle('bg-pink-400')


var MAX_VALUE = 300
var MAX_VALUE_WCURRENT = 800
var MAX_VALUE_CLIFF = 2700
socket.on('SensorData', data => {
    const chargeStatus = ['Not Charging', 'Reconditioning Charging', 'Full Charging', 'Trickle Charging', 'Waiting', 'Charging Error'][data.chargeStatus] || 'Unknown';
    const chargingSources = data.chargingSources === 2 ? 'Docked' : 'None';
    const oiMode = data.oiMode === 2 ? 'Passive' : (data.oiMode === 4 ? 'Full' : 'Safe');

    document.getElementById('oi-mode').innerText = `Mode: ${oiMode}`;
    document.getElementById('dock-status').innerText = `Dock: ${chargingSources}`;
    document.getElementById('charge-status').innerText = `Charging: ${chargeStatus}`;
    document.getElementById('battery-usage').innerText = `Charge: ${data.batteryCharge} / ${data.batteryCapacity}`;
    document.getElementById('battery-voltage').innerText = `Voltage: ${data.batteryVoltage / 1000}V`;
    document.getElementById('brush-current').innerText = `Side Brush: ${data.brushCurrent}mA`;
    document.getElementById('battery-current').innerText = `Current: ${data.batteryCurrent}mA`;
    document.getElementById('main-brush-current').innerText = `Main Brush: ${data.mainBrushCurrent}mA`;
    document.getElementById('dirt-detect').innerText = `Dirt Detect: ${data.dirtDetect}`;

    const names = {
        leftWheel: 'Left Wheel',
        rightWheel: 'Right Wheel',
        mainBrush: 'Main Brush',
        sideBrush: 'Side Brush'
    };
    const active = Object.entries(data.overcurrents || {})
        .filter(([, state]) => state === 'ON')
        .map(([key]) => names[key]);

    if (active.length) {
        dom.overcurrentWarning.textContent = `OVERCURRENT\n${active.join('\n')}`;
        dom.overcurrentWarning.classList.remove('hidden');
        dom.overcurrentStatus.textContent = `Overcurrent: ${active.join(', ')}`;
    } else {
        dom.overcurrentWarning.classList.add('hidden');
        dom.overcurrentStatus.textContent = 'Overcurrent: none';
    }

    updateBumpSensors(data.bumpSensors);

    // console.log(`motor currents: Left: ${data.leftCurrent}mA, Right: ${data.rightCurrent}mA`);

    // console.log('Wall signal:', data.wallSignal);
    // dom.wallSignal.style.width = `${(data.wallSignal / MAX_VALUE) * 100}%`;
    dom.leftCurrentBar.style.height = `${(data.leftCurrent / MAX_VALUE_WCURRENT) * 100}%`;
    dom.rightCurrentBar.style.height = `${(data.rightCurrent / MAX_VALUE_WCURRENT) * 100}%`;

    dom.cliffSensors.L.style.height=`${(data.cliffSensors[0] / MAX_VALUE_CLIFF) * 100}%`
    dom.cliffSensors.FL.style.height=`${(data.cliffSensors[1] / MAX_VALUE_CLIFF) * 100}%`
    dom.cliffSensors.FR.style.height=`${(data.cliffSensors[2] / MAX_VALUE_CLIFF) * 100}%`
    dom.cliffSensors.R.style.height=`${(data.cliffSensors[3] / MAX_VALUE_CLIFF) * 100}%`


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

    if(data.bumpLeft) {
        // dom.bumpLeft.innerText = 'Bump Left: ON';
        dom.bumpLeft.classList.remove('bg-black');
        dom.bumpLeft.classList.add('bg-yellow-500');
    } else {
        // dom.bumpLeft.innerText = 'Bump Left: OFF';
        dom.bumpLeft.classList.remove('bg-yellow-500');
        dom.bumpLeft.classList.add('bg-black');
    }

    if(data.bumpRight) {
        // dom.bumpRight.innerText = 'Bump Right: ON';
        dom.bumpRight.classList.remove('bg-black');
        dom.bumpRight.classList.add('bg-yellow-500');
    } else {
        // dom.bumpRight.innerText = 'Bump Right: OFF';
        dom.bumpRight.classList.remove('bg-yellow-500');
        dom.bumpRight.classList.add('bg-black');
    }

    if(data.wheelDropLeft) {
        // dom.dropLeft.innerText = 'Drop Left: ON';
        dom.dropLeft.classList.remove('bg-black');
        dom.dropLeft.classList.add('bg-yellow-500');
    } else {
        // dom.dropLeft.innerText = 'Drop Left: OFF';
        dom.dropLeft.classList.remove('bg-yellow-500');
        dom.dropLeft.classList.add('bg-black');
    }

    if(data.wheelDropRight) {
        // dom.dropRight.innerText = 'Drop Right: ON';
        dom.dropRight.classList.remove('bg-black');
        dom.dropRight.classList.add('bg-yellow-500');
    } else {
        // dom.dropRight.innerText = 'Drop Right: OFF';
        dom.dropRight.classList.remove('bg-yellow-500');
        dom.dropRight.classList.add('bg-black');
    }




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

socket.on('warning', data => {
    showToast(data, 'warning', false)
})

socket.on('discordGeneralChannels', payload => {
    if (!dom.discordChannelSelect) return;

    const { channels = [], enabled = true, message = '' } = payload || {};
    discordChannelMap.clear();

    dom.discordChannelSelect.innerHTML = '';

    if (dom.discordRefreshButton) {
        dom.discordRefreshButton.disabled = !enabled;
    }

    if (!enabled) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = message || 'Discord bot disabled.';
        option.disabled = true;
        option.selected = true;
        dom.discordChannelSelect.appendChild(option);
        dom.discordChannelSelect.disabled = true;
        if (dom.discordClipButton) dom.discordClipButton.disabled = true;
        if (dom.discordClipStatus) dom.discordClipStatus.textContent = message || 'Discord bot disabled.';
        return;
    }

    if (!channels.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = message || 'No "general" channels found yet.';
        option.disabled = true;
        option.selected = true;
        dom.discordChannelSelect.appendChild(option);
        dom.discordChannelSelect.disabled = true;
        if (dom.discordClipButton) dom.discordClipButton.disabled = true;
        if (dom.discordRefreshButton) dom.discordRefreshButton.disabled = false;
        if (dom.discordClipStatus) dom.discordClipStatus.textContent = message || 'No Discord channels matched yet.';
        return;
    }

    channels.forEach((channel, index) => {
        if (!channel || !channel.id) return;
        discordChannelMap.set(channel.id, channel);
        const option = document.createElement('option');
        option.value = channel.id;
        option.textContent = `${channel.guild} #${channel.name}`;
        if (index === 0) option.selected = true;
        dom.discordChannelSelect.appendChild(option);
    });

    dom.discordChannelSelect.disabled = false;
    if (dom.discordClipButton) dom.discordClipButton.disabled = false;
    if (dom.discordRefreshButton) dom.discordRefreshButton.disabled = false;
    if (dom.discordClipStatus) {
        dom.discordClipStatus.textContent = message || 'Select a Discord channel and send a clip!';
    }
});

socket.on('discordClipStatus', payload => {
    if (!dom.discordClipStatus) return;

    const { status, message = '', channelId, channelName, guildName } = payload || {};
    const channelMeta = channelId ? discordChannelMap.get(channelId) : null;
    const finalChannelName = channelName || channelMeta?.name;
    const finalGuildName = guildName || channelMeta?.guild;
    const prettyChannel = finalChannelName
        ? `#${finalChannelName}${finalGuildName ? ` (${finalGuildName})` : ''}`
        : '';

    let statusMessage = message;
    if (!statusMessage) {
        if (status === 'recording') {
            statusMessage = 'Recording a quick clip...';
        } else if (status === 'uploading') {
            statusMessage = prettyChannel ? `Uploading to ${prettyChannel}...` : 'Uploading clip to Discord...';
        } else if (status === 'success') {
            statusMessage = prettyChannel ? `Clip delivered to ${prettyChannel}!` : 'Clip delivered to Discord!';
        } else if (status === 'busy') {
            statusMessage = 'Another clip is already on the way.';
        } else if (status === 'error') {
            statusMessage = 'Something went wrong sending the clip.';
        }
    }

    dom.discordClipStatus.textContent = statusMessage;

    const working = status === 'recording' || status === 'uploading';
    const hasChannels = discordChannelMap.size > 0;

    if (dom.discordClipButton) {
        dom.discordClipButton.disabled = working || !hasChannels;
    }

    if (dom.discordChannelSelect) {
        dom.discordChannelSelect.disabled = working || !hasChannels;
    }

    if (dom.discordRefreshButton) {
        dom.discordRefreshButton.disabled = working;
    }

    if (status === 'success') {
        showToast(statusMessage, 'success');
    } else if (status === 'error') {
        showToast(statusMessage, 'error');
    } else if (status === 'busy') {
        showToast(statusMessage, 'warning');
    }
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

socket.on('usercount', count => {
    dom.userCount.innerText = `${count} Online`;
})

socket.on('userlist', users => {
    console.log(users)
    document.getElementById('user-list').innerHTML = ''; // Clear previous list
    for (const user of users) {
        const userDiv = document.createElement('div');
        userDiv.className = 'p-1 bg-purple-500 rounded-xl mt-1';
        userDiv.innerText = `${user.id} - Auth: ${user.authenticated}`;
        document.getElementById('user-list').appendChild(userDiv);
        // userDiv.createElement('div').className = 'p-1 bg-purple-500 rounded-full mt-1 w-5 h-5';
    }
})

socket.on('logs', logs => {
    // console.log('Received logs:', logs);
    const logContainer = document.getElementById('log-container');
    logContainer.innerHTML = ''; // Clear previous logs
    if (logs.length === 0) {
        logContainer.innerHTML = '<p class="text-xs">No logs available.</p>';
    }
    logs.forEach(log => {
        const logItem = document.createElement('p');
        logItem.className = 'text-xs font-mono';
        logItem.innerText = log;
        logContainer.appendChild(logItem);
    });
    logContainer.scrollTop = logContainer.scrollHeight; // Scroll to bottom
})

socket.on('ollamaParamsRelay', params => {
    console.log('Received ollama params:', params);
    document.getElementById('ollama-temperature').value = params.temperature;
    document.getElementById('ollama-top_k').value = params.top_k;
    document.getElementById('ollama-top_p').value = params.top_p;
    document.getElementById('ollama-min_k').value = params.min_k;
})

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


if (dom.discordRefreshButton) {
    dom.discordRefreshButton.addEventListener('click', () => {
        requestDiscordChannels();
    });
}

if (dom.discordClipButton) {
    dom.discordClipButton.addEventListener('click', () => {
        sendDiscordClip();
    });
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

document.getElementById('goal-input-submit').addEventListener('click', () => {
    const goalInput = document.getElementById('goal-input');
    const goalText = goalInput.value.trim();
    if (goalText) {
        socket.emit('setGoal', { goal: goalText });
        goalInput.value = ''; // Clear input after sending
    }
});

document.getElementById('user-counter').addEventListener('click', () => {
    const userList = document.getElementById('user-list');
    userList.classList.toggle('hidden');

    //save the stat to a cookie
    const isHidden = userList.classList.contains('hidden');
    document.cookie = `userListHidden=${isHidden}; path=/; max-age=31536000`; // 1 year
});

document.getElementById('hide-controls-button').addEventListener('click', () => {
    const controlsGuide = document.getElementById('controls-guide-container');
    controlsGuide.classList.toggle('hidden');

    //save this state with a cookie
    const isHidden = controlsGuide.classList.contains('hidden');
    document.cookie = `controlsGuideHidden=${isHidden}; path=/; max-age=31536000`; // 1 year
});

//read the cookie to set the initial state
document.addEventListener('DOMContentLoaded', () => {
    const controlsGuide = document.getElementById('controls-guide-container');
    const cookies = document.cookie.split('; ');
    const hiddenCookie = cookies.find(row => row.startsWith('controlsGuideHidden='));
    if (hiddenCookie) {
        const isHidden = hiddenCookie.split('=')[1] === 'true';
        if (isHidden) {
            controlsGuide.classList.add('hidden');
        } else {
            controlsGuide.classList.remove('hidden');
        }
    }

    // read cookie for user list popup aswell
    const userList = document.getElementById('user-list');
    const userListCookie = cookies.find(row => row.startsWith('userListHidden='));
    if (userListCookie) {
        const isHidden = userListCookie.split('=')[1] === 'true';
        if (isHidden) {
            userList.classList.add('hidden');
        } else {
            userList.classList.remove('hidden');
        }
    }

    // read cookie for ollama controls
    // const ollamaPanel = document.getElementById('ollama-panel');
    const ollamaPanelCookie = cookies.find(row => row.startsWith('ollamaPanelHidden='));
    if (ollamaPanelCookie) {
        const isHidden = ollamaPanelCookie.split('=')[1] === 'true';
        if (isHidden) {
            // ollamaPanel.classList.add('hidden');
            document.getElementById('ollama-advanced-controls').classList.add('hidden');
        } else {
            // ollamaPanel.classList.remove('hidden');
            document.getElementById('ollama-advanced-controls').classList.remove('hidden');
        }
    }
});

document.getElementById('request-logs').addEventListener('click', () => {
    socket.emit('requestLogs');
});

document.getElementById('reset-logs').addEventListener('click', () => {
    socket.emit('resetLogs');
    const logContainer = document.getElementById('log-container');
    logContainer.innerHTML = '<p class="text-sm text-gray-300">Logs cleared.</p>';
});

document.getElementById('hide-ollama-button').addEventListener('click', () => {
    const advancedControls = document.getElementById('ollama-advanced-controls');
    advancedControls.classList.toggle('hidden');

    //save the state to a cookie
    const isHidden = advancedControls.classList.contains('hidden');
    document.cookie = `ollamaPanelHidden=${isHidden}; path=/; max-age=31536000`; // 1 year
}); 

movingParams = {
    temperature: 0.7,
    top_k: 40,
    top_p: 0.9,
    min_k: 1
}

function sendParams() {
    socket.emit('ollamaParamsPush', { movingParams });
    console.log('Parameters sent:', movingParams);
}

document.getElementById('ollama-temperature').addEventListener('input', (e) => {
    const temperature = parseFloat(e.target.value);
    if (!isNaN(temperature)) {
        movingParams.temperature = temperature;
        sendParams();
    }
});

document.getElementById('ollama-top_k').addEventListener('input', (e) => {
    const top_k = parseInt(e.target.value, 10);
    if (!isNaN(top_k)) {
        movingParams.top_k = top_k;
        sendParams();
    }
});

document.getElementById('ollama-top_p').addEventListener('input', (e) => {
    const top_p = parseFloat(e.target.value);
    if (!isNaN(top_p)) {
        movingParams.top_p = top_p;
        sendParams();
    }
});

document.getElementById('ollama-min_k').addEventListener('input', (e) => {
    const min_k = parseInt(e.target.value, 10);
    if (!isNaN(min_k)) {
        movingParams.min_k = min_k;
        sendParams();
    }
});
