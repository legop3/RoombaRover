
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
    drivingModeLabel: document.getElementById('driving-mode-label'),
    drivingPermission: document.getElementById('driving-permission'),
    turnCountdown: document.getElementById('turn-countdown'),
    turnQueue: document.getElementById('turn-queue'),
    adminControls: document.getElementById('admin-controls'),
    adminLoginToggle: document.getElementById('admin-login-toggle'),
    turnDurationInput: document.getElementById('turn-duration-input'),
    turnDurationButton: document.getElementById('turn-duration-submit'),
    turnSkipButton: document.getElementById('turn-skip-button'),
    queuePosition: document.getElementById('queue-position'),
    userList: document.getElementById('user-list')
// wallSignal: document.getElementById('wall-distance')
};

const modeButtons = Array.from(document.querySelectorAll('[data-mode-button]'));


var socket = io()

const passwordForm = document.getElementById('password-form');
const passwordInput = document.getElementById('password-input');

if (passwordForm && passwordInput) {
    passwordForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const password = passwordInput.value.trim();
        if (!password) {
            return;
        }

        socket.auth = { token: password };
        socket.disconnect();
        socket.connect();
        passwordInput.value = '';
        passwordForm.classList.add('hidden');
    });
}

if (dom.adminLoginToggle) {
    dom.adminLoginToggle.addEventListener('click', () => {
        if (!passwordForm) return;
        const currentlyHidden = passwordForm.classList.toggle('hidden');
        if (!currentlyHidden) {
            setTimeout(() => passwordInput?.focus(), 0);
        }
    });
}

const knownUsers = new Map();
let selfState = { id: null, isAdmin: false, canDrive: false };
let drivingModeInfo = { mode: 'admin-only', turnDurationMs: 120000, noShowGraceMs: 5000 };
let turnState = { active: false, currentTurn: null, queue: [], noShowGraceMs: 5000 };
let lastControlAt = Date.now();
let noShowTimer = null;

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function updateAdminUI() {
    if (!dom.adminControls) return;
    if (selfState.isAdmin) {
        dom.adminControls.classList.remove('hidden');
    } else {
        dom.adminControls.classList.add('hidden');
    }

    if (dom.adminLoginToggle) {
        if (selfState.isAdmin) {
            dom.adminLoginToggle.classList.add('hidden');
        } else {
            dom.adminLoginToggle.classList.remove('hidden');
        }
    }

    modeButtons.forEach((button) => {
        const mode = button.dataset.modeButton;
        if (!mode) return;
        if (mode === drivingModeInfo.mode) {
            button.classList.add('bg-blue-600');
            button.classList.remove('bg-gray-600');
        } else {
            button.classList.remove('bg-blue-600');
            button.classList.add('bg-gray-600');
        }
    });
}

function renderUserList() {
    if (!dom.userList) return;
    dom.userList.innerHTML = '';
    knownUsers.forEach((user) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'p-1 bg-purple-500 rounded-xl mt-1 flex items-center justify-between gap-2 text-xs md:text-sm';
        const roleLabel = user.isAdmin ? 'Admin' : 'User';
        const driveLabel = user.canDrive ? 'Driving' : 'Waiting';
        const idLabel = user.id === selfState.id ? 'You' : user.id;
        const info = document.createElement('span');
        info.textContent = `${idLabel} • ${roleLabel} • ${driveLabel}`;
        wrapper.appendChild(info);

        if (selfState.isAdmin && !user.isAdmin) {
            const toggle = document.createElement('button');
            toggle.className = 'px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs';
            toggle.dataset.accessToggle = 'true';
            toggle.dataset.socketId = user.id;
            toggle.dataset.allowed = user.canDrive ? 'true' : 'false';
            toggle.textContent = user.canDrive ? 'Revoke drive' : 'Allow drive';
            wrapper.appendChild(toggle);
        }

        dom.userList.appendChild(wrapper);
    });
}

function clearNoShowCheck() {
    if (noShowTimer) {
        clearTimeout(noShowTimer);
        noShowTimer = null;
    }
}

function scheduleNoShowCheck() {
    clearNoShowCheck();
    if (!selfState.canDrive || !turnState.currentTurn || turnState.currentTurn.socketId !== selfState.id) {
        return;
    }
    const grace = turnState.noShowGraceMs || 5000;
    noShowTimer = setTimeout(() => {
        if (!selfState.canDrive) return;
        if (!turnState.currentTurn || turnState.currentTurn.socketId !== selfState.id) return;
        if (Date.now() - lastControlAt >= grace) {
            socket.emit('turns:no-show');
        } else {
            scheduleNoShowCheck();
        }
    }, grace);
}

function recordDrivingActivity() {
    lastControlAt = Date.now();
    scheduleNoShowCheck();
}

function setSelfState(update) {
    const previousCanDrive = selfState.canDrive;
    selfState = { ...selfState, ...update };
    if (previousCanDrive && !selfState.canDrive) {
        if (socket.connected) {
            socket.emit('Speedchange', { leftSpeed: 0, rightSpeed: 0 });
        }
        clearNoShowCheck();
    }
    if (selfState.isAdmin && passwordForm) {
        passwordForm.classList.add('hidden');
    }
    updateAdminUI();
    updateDrivingStatusUI();
}

function describeMode(mode) {
    switch (mode) {
        case 'open-play':
            return 'Open Play';
        case 'turns':
            return 'Turns';
        case 'admin-only':
        default:
            return 'Admin Only';
    }
}

function updateDrivingStatusUI() {
    if (dom.drivingModeLabel) {
        dom.drivingModeLabel.textContent = describeMode(drivingModeInfo.mode);
    }

    if (dom.drivingPermission) {
        if (selfState.canDrive) {
            dom.drivingPermission.textContent = 'You can drive right now.';
            dom.drivingPermission.classList.remove('text-red-300');
            dom.drivingPermission.classList.add('text-green-300');
        } else {
            dom.drivingPermission.textContent = 'You cannot drive yet.';
            dom.drivingPermission.classList.add('text-red-300');
            dom.drivingPermission.classList.remove('text-green-300');
        }
    }

    if (dom.turnCountdown) {
        dom.turnCountdown.classList.add('hidden');
    }
    if (dom.queuePosition) {
        dom.queuePosition.classList.add('hidden');
    }

    const items = [];
    const now = Date.now();

    if (turnState.currentTurn) {
        const currentUser = knownUsers.get(turnState.currentTurn.socketId);
        const label = currentUser ? (currentUser.id === selfState.id ? 'You' : currentUser.id) : turnState.currentTurn.socketId;
        const remaining = formatDuration(turnState.currentTurn.endsAt - now);
        items.push(`Current: ${label} • ${remaining}`);

        if (turnState.currentTurn.socketId === selfState.id && dom.turnCountdown) {
            dom.turnCountdown.textContent = `Time remaining in your turn: ${remaining}`;
            dom.turnCountdown.classList.remove('hidden');
        }
    }

    let queuePosition = null;
    turnState.queue.forEach((entry) => {
        const user = knownUsers.get(entry.socketId);
        const label = user ? (user.id === selfState.id ? 'You' : user.id) : entry.socketId;
        const eta = formatDuration(entry.estimatedStart - now);
        items.push(`#${entry.position} ${label} • ${eta}`);
        if (entry.socketId === selfState.id) {
            queuePosition = entry.position;
            if (dom.turnCountdown) {
                dom.turnCountdown.textContent = `Your turn starts in approximately ${eta}`;
                dom.turnCountdown.classList.remove('hidden');
            }
        }
    });

    if (dom.queuePosition && queuePosition !== null) {
        dom.queuePosition.textContent = `Queue position: #${queuePosition}`;
        dom.queuePosition.classList.remove('hidden');
    }

    if (dom.turnQueue) {
        if (items.length === 0) {
            dom.turnQueue.innerHTML = '<p class="text-xs text-gray-300">No turn rotation active.</p>';
        } else {
            dom.turnQueue.innerHTML = items
                .map((text) => `<p class="text-xs text-gray-200">${text}</p>`)
                .join('');
        }
    }
}

modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
        if (!selfState.isAdmin) return;
        const mode = button.dataset.modeButton;
        if (!mode) return;
        socket.emit('driving-mode:set', mode);
    });
});

if (dom.turnDurationButton && dom.turnDurationInput) {
    dom.turnDurationButton.addEventListener('click', () => {
        if (!selfState.isAdmin) return;
        const seconds = Number(dom.turnDurationInput.value);
        if (!Number.isFinite(seconds) || seconds <= 0) {
            return;
        }
        socket.emit('turns:set-duration', { seconds });
    });
}

if (dom.turnSkipButton) {
    dom.turnSkipButton.addEventListener('click', () => {
        if (!selfState.isAdmin) return;
        socket.emit('turns:skip');
    });
}

if (dom.userList) {
    dom.userList.addEventListener('click', (event) => {
        if (!selfState.isAdmin) return;
        const target = event.target.closest('[data-access-toggle]');
        if (!target) return;
        const socketId = target.dataset.socketId;
        const allowed = target.dataset.allowed === 'true';
        if (!socketId || socketId === selfState.id) return;
        socket.emit('access:set-driving', { socketId, canDrive: !allowed });
    });
}

updateAdminUI();
updateDrivingStatusUI();
renderUserList();



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

    setSelfState({ id: socket.id });

    sensorData()
    startVideo()
    stopAudio()
    startAudio()

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
    clearNoShowCheck();
    setSelfState({ canDrive: false });
});

socket.on('system-stats', data => {
    dom.cpuUsage.textContent = `CPU: ${data.cpu}%`;
    dom.memoryUsage.textContent = `RAM: ${data.memory}%`;
});

socket.on('driving-access', (canDrive) => {
    setSelfState({ canDrive });
    if (canDrive) {
        recordDrivingActivity();
    }
});

socket.on('access:self', (data) => {
    setSelfState(data);
});

socket.on('driving-mode', (info) => {
    drivingModeInfo = info;
    if (dom.turnDurationInput && typeof info.turnDurationMs === 'number') {
        dom.turnDurationInput.value = Math.round(info.turnDurationMs / 1000);
    }
    updateAdminUI();
    updateDrivingStatusUI();
});

socket.on('turns:state', (state) => {
    turnState = state;
    scheduleNoShowCheck();
    updateDrivingStatusUI();
});

socket.on('turns:your-turn', () => {
    recordDrivingActivity();
});

socket.on('turns:ended', () => {
    clearNoShowCheck();
});

// key handler function
const pressedKeys = new Set();
function handleKeyEvent(event, isKeyDown) {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'shift', '\\'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        if (!selfState.canDrive) return;
        const speeds = keySpeedCalculator(pressedKeys);
        recordDrivingActivity();
        socket.emit('Speedchange', speeds);
    }

    // key controls for side brush
    if (['o', 'l'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        if (!selfState.canDrive) return;
        if (pressedKeys.has('o')) speed = 127
        if (pressedKeys.has('l')) speed = -50
        if (!pressedKeys.has('o') && !pressedKeys.has('l')) speed = 0

        recordDrivingActivity();
        socket.emit('sideBrush', { speed: speed })

    }

    //key controls for vacuum motor
    if (['i', 'k'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        if (!selfState.canDrive) return;
        if (pressedKeys.has('i')) speed = 127
        if (pressedKeys.has('k')) speed = 20
        if (!pressedKeys.has('i') && !pressedKeys.has('k')) speed = 0

        recordDrivingActivity();
        socket.emit('vacuumMotor', { speed: speed })

    }

    // key controls for brush motor
    if (['p', ';'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;
        if (!selfState.canDrive) return;
        if (pressedKeys.has('p')) speed = 127
        if (pressedKeys.has(';')) speed = -50
        if (!pressedKeys.has('p') && !pressedKeys.has(';')) speed = 0

        recordDrivingActivity();
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

function dockNow() {
    if (!selfState.canDrive) return;
    recordDrivingActivity();
    socket.emit('Docking', { action: 'dock' });
}
function reconnectRoomba() {
    if (!selfState.canDrive) return;
    recordDrivingActivity();
    socket.emit('Docking', { action: 'reconnect' });
}
function sensorData() { socket.emit('requestSensorData'); }
function startVideo() { socket.emit('startVideo'); }
function stopVideo() {
    if (!selfState.isAdmin) return;
    socket.emit('stopVideo');
}
function startAudio() { socket.emit('startAudio'); }
function stopAudio() {
    if (!selfState.isAdmin) return;
    socket.emit('stopAudio');
}
function sideBrush(state) {
    if (!selfState.canDrive) return;
    recordDrivingActivity();
    socket.emit('sideBrush', { action:state });
}

function easyStart() {
    if (!selfState.isAdmin) return;
    socket.emit('easyStart');
}
function easyDock() {
    if (!selfState.isAdmin) return;
    socket.emit('easyDock');
}

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
    knownUsers.clear();
    users.forEach((user) => knownUsers.set(user.id, user));
    renderUserList();
    updateDrivingStatusUI();
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
    if (!selfState.canDrive) return;
    let leftSpeed = data.vector.y * MAX_SPEED + data.vector.x * MAX_SPEED;
    let rightSpeed = data.vector.y * MAX_SPEED - data.vector.x * MAX_SPEED;

    leftSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, leftSpeed));
    rightSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, rightSpeed));

    leftSpeed = Math.round(leftSpeed);
    rightSpeed = Math.round(rightSpeed);

    // console.log(data.vector.x, data.vector.y);
    // console.log(`Left: ${leftSpeed}, Right: ${rightSpeed}`);
    recordDrivingActivity();
    socket.emit('Speedchange', { leftSpeed, rightSpeed });
});

joystick.on('end', function () {
    if (!selfState.canDrive) return;
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
    if (!selfState.canDrive) return;
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
        if (selfState.canDrive) {
            socket.emit('userWebcam', data);
        }
        // console.log(data);
    }, 1000 / 2);
}

function stopWebcam() {
    console.log('stopping webcam')
}



// send a message to the roomba screen
document.getElementById('sendMessageButton').addEventListener('click', () => {
    if (!selfState.canDrive && !selfState.isAdmin) return;
    const message = document.getElementById('messageInput').value
    socket.emit('userMessage', { message, beep: document.getElementById('beepcheck').checked });
    document.getElementById('messageInput').value = '';
});

// send typing status to roomba screen
document.getElementById('messageInput').addEventListener('input', () => {
    if (!selfState.canDrive && !selfState.isAdmin) return;
    const message = document.getElementById('messageInput').value
    socket.emit('userTyping', { message, beep: document.getElementById('beepcheck').checked });
});

// handle events from aux motor buttons on the joystick card
document.getElementById('brushForwardButton').addEventListener('pointerdown', () => {
    if (!selfState.canDrive) return;
    recordDrivingActivity();
    socket.emit('sideBrush', { speed: 127 });
})
document.getElementById('brushForwardButton').addEventListener('pointerup', () => {
    if (!selfState.canDrive) return;
    socket.emit('sideBrush', { speed: 0 });
})
document.getElementById('brushReverseButton').addEventListener('pointerdown', () => {
    if (!selfState.canDrive) return;
    recordDrivingActivity();
    socket.emit('sideBrush', { speed: -127 });
})
document.getElementById('brushReverseButton').addEventListener('pointerup', () => {
    if (!selfState.canDrive) return;
    socket.emit('sideBrush', { speed: 0 });
})
document.getElementById('vacuumMotorButton').addEventListener('pointerdown', () => {
    if (!selfState.canDrive) return;
    recordDrivingActivity();
    socket.emit('vacuumMotor', { speed: 127 });
})
document.getElementById('vacuumMotorButton').addEventListener('pointerup', () => {
    if (!selfState.canDrive) return;
    socket.emit('vacuumMotor', { speed: 0 });
})

document.getElementById('ai-start-button').addEventListener('click', () => {
    if (!selfState.isAdmin) return;
    socket.emit('enableAIMode', { enabled: true });
});

document.getElementById('ai-stop-button').addEventListener('click', () => {
    if (!selfState.isAdmin) return;
    socket.emit('enableAIMode', { enabled: false });
});

document.getElementById('goal-input-submit').addEventListener('click', () => {
    const goalInput = document.getElementById('goal-input');
    const goalText = goalInput.value.trim();
    if (!selfState.isAdmin) return;
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
    if (!selfState.isAdmin) return;
    socket.emit('requestLogs');
});

document.getElementById('reset-logs').addEventListener('click', () => {
    if (!selfState.isAdmin) return;
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
    if (!selfState.isAdmin) return;
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
