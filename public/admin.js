const dom = {
    controlModeLabel: document.getElementById('control-mode-label'),
    controlModeDescription: document.getElementById('control-mode-description'),
    controlModeSelect: document.getElementById('control-mode-select'),
    controlModeSelector: document.getElementById('control-mode-selector'),
    controlModePreview: document.getElementById('control-mode-label-preview'),
    adminLoginForm: document.getElementById('admin-login-form'),
    adminPasswordInput: document.getElementById('admin-password-input'),
    adminLoginStatus: document.getElementById('admin-login-status'),
    adminLoginError: document.getElementById('admin-login-error'),
    driverQueueList: document.getElementById('driver-queue-list'),
    turnStatusMessage: document.getElementById('turn-status-message'),
    turnTimerInfo: document.getElementById('turn-timer-info'),
    authStatusLabel: document.getElementById('auth-status-label'),
    userCounter: document.getElementById('user-counter'),
    alertFeed: document.getElementById('alert-feed'),
    overcurrentWarning: document.getElementById('overcurrent-warning'),
    overcurrentStatus: document.getElementById('overcurrent-status'),
    startButtonMessage: document.getElementById('start-button-message'),
    dockButtonMessage: document.getElementById('dock-button-message'),
    dockChargingMessage: document.getElementById('dock-button-charging-message'),
    oiMode: document.getElementById('oi-mode'),
    dockStatus: document.getElementById('dock-status'),
    chargeStatus: document.getElementById('charge-status'),
    batteryUsage: document.getElementById('battery-usage'),
    batteryVoltage: document.getElementById('battery-voltage'),
    brushCurrent: document.getElementById('brush-current'),
    batteryCurrent: document.getElementById('battery-current'),
    mainBrushCurrent: document.getElementById('main-brush-current'),
    dirtDetect: document.getElementById('dirt-detect'),
    cpuUsage: document.getElementById('cpu-usage'),
    memoryUsage: document.getElementById('memory-usage'),
    bumpLeft: document.getElementById('bump-left'),
    bumpRight: document.getElementById('bump-right'),
    dropLeft: document.getElementById('drop-left'),
    dropRight: document.getElementById('drop-right'),
    leftCurrentBar: document.getElementById('leftCurrent-bar'),
    rightCurrentBar: document.getElementById('rightCurrent-bar'),
    connectStatus: document.getElementById('connectstatus'),
    blinker: document.getElementById('blinker'),
    sensorBlinker: document.getElementById('sensorblinker'),
};

dom.cliffSensors = {
    L: document.getElementById('cliff-L'),
    FL: document.getElementById('cliff-FL'),
    FR: document.getElementById('cliff-FR'),
    R: document.getElementById('cliff-R'),
};

dom.bumpSensors = {
    L: document.getElementById('lightbump-L'),
    FL: document.getElementById('lightbump-FL'),
    CL: document.getElementById('lightbump-CL'),
    CR: document.getElementById('lightbump-CR'),
    FR: document.getElementById('lightbump-FR'),
    R: document.getElementById('lightbump-R'),
};

const CONTROL_MODE_DETAILS = {
    public: {
        label: 'Public',
        description: 'Anyone can drive without logging in.'
    },
    turns: {
        label: 'Turns',
        description: 'Non-admin drivers take timed turns using the queue.'
    },
    'admin-only': {
        label: 'Admin Only',
        description: 'Only admins can drive. Viewers can still watch the rover.'
    }
};

let sessionState = { authenticated: false, isAdmin: false };
let currentControlMode = 'public';
let configuredTurnDurationMs = 45000;
let driverQueueState = null;
let driverQueueInterval = null;
const alertHistory = [];

const socket = io();
let frontVideoUrl = null;

function getModeDetails(mode) {
    return CONTROL_MODE_DETAILS[mode] || {
        label: 'Unknown',
        description: 'Control mode information unavailable.'
    };
}

function updateControlModeUI(mode) {
    const details = getModeDetails(mode);
    if (dom.controlModeLabel) {
        dom.controlModeLabel.innerText = details.label;
    }
    if (dom.controlModeDescription) {
        dom.controlModeDescription.innerText = details.description;
    }
    if (dom.controlModeSelect && CONTROL_MODE_DETAILS[mode]) {
        dom.controlModeSelect.value = mode;
    }
    if (dom.controlModePreview) {
        dom.controlModePreview.innerText = details.label;
    }
}

function updateSessionUI() {
    if (dom.adminLoginStatus) {
        if (sessionState.isAdmin) {
            dom.adminLoginStatus.classList.remove('hidden');
            dom.adminLoginStatus.innerText = 'Logged in as admin.';
        } else {
            dom.adminLoginStatus.classList.add('hidden');
        }
    }

    if (dom.adminLoginError && sessionState.isAdmin) {
        dom.adminLoginError.classList.add('hidden');
    }

    if (dom.controlModeSelector) {
        if (sessionState.isAdmin) {
            dom.controlModeSelector.classList.remove('hidden');
        } else {
            dom.controlModeSelector.classList.add('hidden');
        }
    }

    if (dom.controlModeSelect) {
        dom.controlModeSelect.disabled = !sessionState.isAdmin;
    }

    if (dom.authStatusLabel) {
        let label = 'No';
        if (sessionState.isAdmin) {
            label = 'Admin';
        } else if (sessionState.authenticated) {
            label = 'Yes';
        }
        dom.authStatusLabel.innerText = label;
    }
}

function pushAlert(message, type = 'info') {
    if (!dom.alertFeed) return;

    const timestamp = new Date().toLocaleTimeString();
    alertHistory.unshift({ message, type, timestamp });
    if (alertHistory.length > 10) {
        alertHistory.pop();
    }

    dom.alertFeed.innerHTML = '';
    alertHistory.forEach(entry => {
        const item = document.createElement('p');
        const color = entry.type === 'error' ? 'text-red-300' : entry.type === 'warning' ? 'text-yellow-300' : 'text-gray-200';
        item.className = `${color} text-xs`;
        item.innerText = `[${entry.timestamp}] ${entry.message}`;
        dom.alertFeed.appendChild(item);
    });
}

function formatDuration(ms, options = {}) {
    const { showNow = false } = options;
    if (typeof ms !== 'number' || Number.isNaN(ms)) {
        return '--:--';
    }
    if (showNow && ms <= 1000) {
        return 'Now';
    }

    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function renderDriverQueue() {
    if (!dom.driverQueueList) return;

    const payload = driverQueueState?.payload || null;
    const receivedAt = driverQueueState?.receivedAt || 0;
    const mode = payload?.mode || currentControlMode;
    const isTurnMode = mode === 'turns';
    const queue = payload?.queue || [];
    const now = Date.now();
    const elapsed = Math.max(0, receivedAt ? now - receivedAt : 0);
    const turnDuration = payload?.turnDurationMs ?? configuredTurnDurationMs;

    dom.driverQueueList.innerHTML = '';

    if (!isTurnMode) {
        const message = document.createElement('p');
        message.className = 'text-xs text-gray-300 text-center';
        message.innerText = mode === 'admin-only'
            ? 'Turn queue is disabled while the rover is in Admin Only mode.'
            : 'Turn queue is disabled in this mode.';
        dom.driverQueueList.appendChild(message);
        if (dom.turnStatusMessage) {
            const details = getModeDetails(mode);
            dom.turnStatusMessage.innerText = `Control mode: ${details.label}.`;
        }
        if (dom.turnTimerInfo) {
            dom.turnTimerInfo.innerText = 'Switch to Turns mode to manage the driving queue.';
        }
        if (driverQueueInterval) {
            clearInterval(driverQueueInterval);
            driverQueueInterval = null;
        }
        return;
    }

    if (!queue.length) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'text-xs text-gray-300 text-center';
        emptyMessage.innerText = 'The driver queue is empty.';
        dom.driverQueueList.appendChild(emptyMessage);
        if (dom.turnStatusMessage) dom.turnStatusMessage.innerText = 'No drivers are waiting.';
        if (dom.turnTimerInfo) dom.turnTimerInfo.innerText = `Turn length: ${formatDuration(turnDuration)} per driver.`;
        if (!driverQueueInterval) {
            driverQueueInterval = setInterval(renderDriverQueue, 1000);
        }
        return;
    }

    queue.forEach(entry => {
        const item = document.createElement('div');
        item.className = `px-3 py-2 rounded-lg ${entry.isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'}`;

        const label = document.createElement('div');
        label.className = 'text-sm font-semibold';
        label.innerText = entry.label;

        const details = document.createElement('div');
        details.className = 'text-xs text-gray-200 flex justify-between';
        const timeRemaining = Math.max(0, (entry.isCurrent ? payload.remainingMs : entry.timeRemainingMs) - elapsed);
        const eta = Math.max(0, entry.etaMs - elapsed);

        const statusText = entry.isCurrent
            ? `Driving now • ${formatDuration(timeRemaining)} left`
            : `ETA ${formatDuration(eta, { showNow: true })}`;

        details.innerText = statusText;

        item.appendChild(label);
        item.appendChild(details);
        dom.driverQueueList.appendChild(item);
    });

    const currentEntry = queue.find(entry => entry.isCurrent);
    if (dom.turnStatusMessage) {
        dom.turnStatusMessage.innerText = currentEntry
            ? `Current driver: ${currentEntry.label}`
            : 'A new driver will be selected soon.';
    }

    if (dom.turnTimerInfo) {
        dom.turnTimerInfo.innerText = currentEntry
            ? `Time remaining: ${formatDuration(Math.max(0, (payload.remainingMs ?? turnDuration) - elapsed))}`
            : `Turn length: ${formatDuration(turnDuration)} per driver.`;
    }

    if (!driverQueueInterval) {
        driverQueueInterval = setInterval(renderDriverQueue, 1000);
    }
}

if (dom.adminLoginForm) {
    dom.adminLoginForm.addEventListener('submit', event => {
        event.preventDefault();
        const password = dom.adminPasswordInput ? dom.adminPasswordInput.value.trim() : '';
        if (!password) {
            return;
        }

        socket.auth = { ...(socket.auth || {}), token: password };
        socket.disconnect();
        socket.connect();

        if (dom.adminPasswordInput) {
            dom.adminPasswordInput.value = '';
            dom.adminPasswordInput.blur();
        }

        if (dom.adminLoginError) {
            dom.adminLoginError.classList.add('hidden');
        }
    });
}

if (dom.controlModeSelect) {
    dom.controlModeSelect.addEventListener('change', event => {
        const nextMode = event.target.value;
        if (!sessionState.isAdmin) {
            updateSessionUI();
            updateControlModeUI(currentControlMode);
            return;
        }

        socket.emit('setControlMode', { mode: nextMode });
    });
}

socket.on('auth-init', () => {
    if (dom.adminLoginStatus) {
        dom.adminLoginStatus.classList.add('hidden');
    }
    if (dom.adminPasswordInput) {
        dom.adminPasswordInput.focus();
    }
});

socket.on('adminAuthResult', ({ success }) => {
    if (success) {
        if (dom.adminLoginError) {
            dom.adminLoginError.classList.add('hidden');
        }
        if (dom.adminLoginStatus) {
            dom.adminLoginStatus.classList.remove('hidden');
            dom.adminLoginStatus.innerText = 'Logged in as admin.';
        }
    } else {
        if (dom.adminLoginError) {
            dom.adminLoginError.classList.remove('hidden');
            dom.adminLoginError.innerText = 'Incorrect admin password. Please try again.';
        }
        if (socket.auth) {
            delete socket.auth.token;
        }
        if (dom.adminPasswordInput) {
            dom.adminPasswordInput.focus();
        }
    }
});

socket.on('sessionState', state => {
    sessionState = { ...sessionState, ...state };
    if (state && typeof state.mode === 'string') {
        currentControlMode = state.mode;
        updateControlModeUI(currentControlMode);
    }
    updateSessionUI();
});

socket.on('controlModeUpdate', data => {
    if (data && typeof data.mode === 'string') {
        currentControlMode = data.mode;
        updateControlModeUI(currentControlMode);
    }
    if (data && typeof data.turnDurationMs === 'number') {
        configuredTurnDurationMs = data.turnDurationMs;
    }
    updateSessionUI();
    renderDriverQueue();
});

socket.on('driverQueueUpdate', payload => {
    driverQueueState = { payload, receivedAt: Date.now() };
    renderDriverQueue();
});

socket.on('usercount', count => {
    if (dom.userCounter) {
        dom.userCounter.innerText = `${count} Online`;
    }
});

socket.on('system-stats', data => {
    if (dom.cpuUsage) dom.cpuUsage.innerText = `CPU: ${data.cpu}%`;
    if (dom.memoryUsage) dom.memoryUsage.innerText = `RAM: ${data.memory}%`;
});

socket.on('message', data => {
    pushAlert(data, 'info');
    if (typeof showToast === 'function') {
        showToast(data, 'info');
    }
});

socket.on('alert', data => {
    pushAlert(data, 'warning');
    if (typeof showToast === 'function') {
        showToast(data, 'error');
    }
});

socket.on('warning', data => {
    pushAlert(data, 'warning');
});

const MAX_VALUE_WCURRENT = 800;
const MAX_VALUE_CLIFF = 2700;
const bumpKeys = ['L', 'FL', 'CL', 'CR', 'FR', 'R'];

function getMaxForRange(value) {
    if (value < 100) return 100;
    if (value < 500) return 500;
    if (value < 1000) return 1000;
    if (value < 1500) return 1500;
    return 2000;
}

function updateBumpSensors(bumpValues) {
    bumpKeys.forEach((key, index) => {
        const value = bumpValues[index];
        const el = dom.bumpSensors[key];
        if (!el) return;

        const max = getMaxForRange(value);
        const widthPercent = (value / max) * 100;
        const newColor = `hsl(${max / 2}, 100%, 50%)`;

        if (Math.abs(parseFloat(el.style.width || 0) - widthPercent) > 1) {
            el.style.width = `${widthPercent}%`;
            el.style.backgroundColor = newColor;
        }
    });
}

socket.on('SensorData', data => {
    const chargeStatus = ['Not Charging', 'Reconditioning Charging', 'Full Charging', 'Trickle Charging', 'Waiting', 'Charging Error'][data.chargeStatus] || 'Unknown';
    const chargingSources = data.chargingSources === 2 ? 'Docked' : 'None';
    const oiMode = data.oiMode === 2 ? 'Passive' : (data.oiMode === 4 ? 'Full' : 'Safe');

    if (dom.oiMode) dom.oiMode.innerText = `Mode: ${oiMode}`;
    if (dom.dockStatus) dom.dockStatus.innerText = `Dock: ${chargingSources}`;
    if (dom.chargeStatus) dom.chargeStatus.innerText = `Charging: ${chargeStatus}`;
    if (dom.batteryUsage) dom.batteryUsage.innerText = `Charge: ${data.batteryCharge} / ${data.batteryCapacity}`;
    if (dom.batteryVoltage) dom.batteryVoltage.innerText = `Voltage: ${data.batteryVoltage / 1000}V`;
    if (dom.brushCurrent) dom.brushCurrent.innerText = `Side Brush: ${data.brushCurrent}mA`;
    if (dom.batteryCurrent) dom.batteryCurrent.innerText = `Current: ${data.batteryCurrent}mA`;
    if (dom.mainBrushCurrent) dom.mainBrushCurrent.innerText = `Main Brush: ${data.mainBrushCurrent}mA`;
    if (dom.dirtDetect) dom.dirtDetect.innerText = `Dirt Detect: ${data.dirtDetect}`;

    const names = {
        leftWheel: 'Left Wheel',
        rightWheel: 'Right Wheel',
        mainBrush: 'Main Brush',
        sideBrush: 'Side Brush'
    };
    const active = Object.entries(data.overcurrents || {})
        .filter(([, state]) => state === 'ON')
        .map(([key]) => names[key]);

    if (dom.overcurrentWarning && dom.overcurrentStatus) {
        if (active.length) {
            dom.overcurrentWarning.textContent = `OVERCURRENT\n${active.join('\n')}`;
            dom.overcurrentWarning.classList.remove('hidden');
            dom.overcurrentStatus.textContent = `Overcurrent: ${active.join(', ')}`;
        } else {
            dom.overcurrentWarning.classList.add('hidden');
            dom.overcurrentStatus.textContent = 'Overcurrent: none';
        }
    }

    updateBumpSensors(data.bumpSensors);

    if (dom.leftCurrentBar) {
        dom.leftCurrentBar.style.height = `${(data.leftCurrent / MAX_VALUE_WCURRENT) * 100}%`;
    }
    if (dom.rightCurrentBar) {
        dom.rightCurrentBar.style.height = `${(data.rightCurrent / MAX_VALUE_WCURRENT) * 100}%`;
    }

    if (dom.cliffSensors) {
        dom.cliffSensors.L.style.height = `${(data.cliffSensors[0] / MAX_VALUE_CLIFF) * 100}%`;
        dom.cliffSensors.FL.style.height = `${(data.cliffSensors[1] / MAX_VALUE_CLIFF) * 100}%`;
        dom.cliffSensors.FR.style.height = `${(data.cliffSensors[2] / MAX_VALUE_CLIFF) * 100}%`;
        dom.cliffSensors.R.style.height = `${(data.cliffSensors[3] / MAX_VALUE_CLIFF) * 100}%`;
    }

    if (dom.startButtonMessage) {
        if (oiMode === 'Full') {
            dom.startButtonMessage.innerText = 'Ready to Drive!';
            dom.startButtonMessage.classList.remove('bg-red-600');
            dom.startButtonMessage.classList.add('bg-green-500');
        } else {
            dom.startButtonMessage.innerText = 'Not in Driving Mode!';
            dom.startButtonMessage.classList.remove('bg-green-500');
            dom.startButtonMessage.classList.add('bg-red-600');
        }
    }

    if (dom.dockButtonMessage && dom.dockChargingMessage) {
        if (chargingSources === 'Docked') {
            dom.dockButtonMessage.innerText = 'Docked!';
            dom.dockButtonMessage.classList.remove('bg-red-600');
            dom.dockButtonMessage.classList.add('bg-green-500');
            if (chargeStatus === 'Not Charging') {
                dom.dockChargingMessage.innerText = 'Not Charging!';
                dom.dockChargingMessage.classList.remove('bg-green-500');
                dom.dockChargingMessage.classList.add('bg-red-600');
            } else {
                dom.dockChargingMessage.innerText = chargeStatus;
                dom.dockChargingMessage.classList.remove('bg-red-600');
                dom.dockChargingMessage.classList.add('bg-green-500');
            }
        } else {
            dom.dockButtonMessage.innerText = 'Not Docked!';
            dom.dockButtonMessage.classList.remove('bg-green-500');
            dom.dockButtonMessage.classList.add('bg-red-600');
        }
    }

    if (dom.sensorBlinker) {
        dom.sensorBlinker.classList.toggle('bg-pink-400');
        dom.sensorBlinker.classList.toggle('bg-black');
    }

    if (dom.bumpLeft) {
        if (data.bumpLeft) {
            dom.bumpLeft.classList.remove('bg-black');
            dom.bumpLeft.classList.add('bg-yellow-500');
        } else {
            dom.bumpLeft.classList.remove('bg-yellow-500');
            dom.bumpLeft.classList.add('bg-black');
        }
    }

    if (dom.bumpRight) {
        if (data.bumpRight) {
            dom.bumpRight.classList.remove('bg-black');
            dom.bumpRight.classList.add('bg-yellow-500');
        } else {
            dom.bumpRight.classList.remove('bg-yellow-500');
            dom.bumpRight.classList.add('bg-black');
        }
    }

    if (dom.dropLeft) {
        if (data.wheelDropLeft) {
            dom.dropLeft.classList.remove('bg-black');
            dom.dropLeft.classList.add('bg-yellow-500');
        } else {
            dom.dropLeft.classList.remove('bg-yellow-500');
            dom.dropLeft.classList.add('bg-black');
        }
    }

    if (dom.dropRight) {
        if (data.wheelDropRight) {
            dom.dropRight.classList.remove('bg-black');
            dom.dropRight.classList.add('bg-yellow-500');
        } else {
            dom.dropRight.classList.remove('bg-yellow-500');
            dom.dropRight.classList.add('bg-black');
        }
    }
});

socket.on('videoFrame:frontCamera', data => {
    const blob = new Blob([data], { type: 'image/jpeg' });
    if (frontVideoUrl) URL.revokeObjectURL(frontVideoUrl);
    frontVideoUrl = URL.createObjectURL(blob);
    const videoEl = document.getElementById('video');
    if (videoEl) {
        videoEl.src = frontVideoUrl;
    }

    if (dom.blinker) {
        dom.blinker.classList.toggle('bg-red-500');
        dom.blinker.classList.toggle('bg-green-500');
    }
});

socket.on('disconnect', () => {
    if (dom.connectStatus) {
        dom.connectStatus.innerText = 'Disconnected';
        dom.connectStatus.classList.remove('bg-green-500');
        dom.connectStatus.classList.add('bg-red-500');
    }
});

socket.on('connect', () => {
    if (dom.connectStatus) {
        dom.connectStatus.innerText = 'Connected';
        dom.connectStatus.classList.remove('bg-red-500');
        dom.connectStatus.classList.add('bg-green-500');
    }
    if (dom.blinker) {
        dom.blinker.classList.remove('bg-green-500');
        dom.blinker.classList.add('bg-red-500');
    }

    socket.emit('requestSensorData');
    socket.emit('startVideo');
});

window.addEventListener('beforeunload', () => {
    if (frontVideoUrl) {
        URL.revokeObjectURL(frontVideoUrl);
    }
    if (driverQueueInterval) {
        clearInterval(driverQueueInterval);
    }
});
