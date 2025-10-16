import {dom} from './dom.js';
import { socket } from './socketGlobal.js';

console.log("hudAndSensors module loaded");

const sensorBlinker = document.getElementById('sensorblinker');
if (sensorBlinker) {
    sensorBlinker.classList.toggle('bg-pink-400');
}


function updateChargeAlertOverlay(alertPayload) {
    if (!dom.chargeWarning) return;
    if (alertPayload && alertPayload.active && alertPayload.message) {
        dom.chargeWarning.textContent = alertPayload.message;
        dom.chargeWarning.classList.remove('hidden');
    } else {
        dom.chargeWarning.textContent = '';
        dom.chargeWarning.classList.add('hidden');
    }
}
const MAX_VALUE = 300;
const MAX_VALUE_WCURRENT = 800;
const MAX_VALUE_CLIFF = 2700;
socket.on('SensorData', data => {
    const chargeStatusIndex = typeof data.chargeStatus === 'number' ? data.chargeStatus : 0;
    const chargeStatus = ['Not Charging', 'Reconditioning Charging', 'Full Charging', 'Trickle Charging', 'Waiting', 'Charging Error'][chargeStatusIndex] || 'Unknown';
    const chargingSources = data.chargingSources === 2 ? 'Docked' : 'None';
    const oiMode = data.oiMode === 2 ? 'Passive' : (data.oiMode === 4 ? 'Full' : 'Safe');

    if (dom.oiMode) dom.oiMode.innerText = `Mode: ${oiMode}`;
    if (dom.dockStatus) dom.dockStatus.innerText = `Dock: ${chargingSources}`;
    if (dom.chargeStatus) dom.chargeStatus.innerText = `Charging: ${chargeStatus}`;
    const voltageForDisplay = typeof data.batteryVoltageFiltered === 'number' && data.batteryVoltageFiltered > 0
        ? data.batteryVoltageFiltered
        : data.batteryVoltage;
    if (dom.batteryUsage) dom.batteryUsage.innerText = `Charge: ${data.batteryCharge} / ${data.batteryCapacity}`;
    if (dom.batteryVoltage) dom.batteryVoltage.innerText = `Voltage: ${voltageForDisplay / 1000}V`;
    if (dom.brushCurrent) dom.brushCurrent.innerText = `Side Brush: ${data.brushCurrent}mA`;
    if (dom.batteryCurrent) dom.batteryCurrent.innerText = `Current: ${data.batteryCurrent}mA`;
    if (dom.mainBrushCurrent) dom.mainBrushCurrent.innerText = `Main Brush: ${data.mainBrushCurrent}mA`;
    if (dom.dirtDetect) dom.dirtDetect.innerText = `Dirt Detect: ${data.dirtDetect}`;

    updateChargeAlertOverlay(data.chargeAlert);

    const names = {
        leftWheel: 'Left Wheel',
        rightWheel: 'Right Wheel',
        mainBrush: 'Main Brush',
        sideBrush: 'Side Brush'
    };
    const active = Object.entries(data.overcurrents || {})
        .filter(([, state]) => state === 'ON')
        .map(([key]) => names[key]);

    if (active.length && dom.overcurrentWarning && dom.overcurrentStatus) {
        dom.overcurrentWarning.textContent = `OVERCURRENT\n${active.join('\n')}`;
        dom.overcurrentWarning.classList.remove('hidden');
        dom.overcurrentStatus.textContent = `Overcurrent: ${active.join(', ')}`;
    } else if (dom.overcurrentWarning && dom.overcurrentStatus) {
        dom.overcurrentWarning.classList.add('hidden');
        dom.overcurrentStatus.textContent = 'Overcurrent: none';
    }

    updateBumpSensors(data.bumpSensors);

    // console.log(`motor currents: Left: ${data.leftCurrent}mA, Right: ${data.rightCurrent}mA`);

    // console.log('Wall signal:', data.wallSignal);
    // dom.wallSignal.style.width = `${(data.wallSignal / MAX_VALUE) * 100}%`;
    if (dom.leftCurrentBar) dom.leftCurrentBar.style.height = `${(data.leftCurrent / MAX_VALUE_WCURRENT) * 100}%`;
    if (dom.rightCurrentBar) dom.rightCurrentBar.style.height = `${(data.rightCurrent / MAX_VALUE_WCURRENT) * 100}%`;

    if (dom.cliffSensors?.L) dom.cliffSensors.L.style.height = `${(data.cliffSensors[0] / MAX_VALUE_CLIFF) * 100}%`;
    if (dom.cliffSensors?.FL) dom.cliffSensors.FL.style.height = `${(data.cliffSensors[1] / MAX_VALUE_CLIFF) * 100}%`;
    if (dom.cliffSensors?.FR) dom.cliffSensors.FR.style.height = `${(data.cliffSensors[2] / MAX_VALUE_CLIFF) * 100}%`;
    if (dom.cliffSensors?.R) dom.cliffSensors.R.style.height = `${(data.cliffSensors[3] / MAX_VALUE_CLIFF) * 100}%`;


    if (dom.startButtonMessage) {
        if (oiMode === 'Full') {
            dom.startButtonMessage.innerText = 'Ready to Drive!';
            dom.startButtonMessage.classList.remove('bg-red-500');
            dom.startButtonMessage.classList.add('bg-green-500');
        } else {
            dom.startButtonMessage.innerText = 'Not in Driving Mode!';
            dom.startButtonMessage.classList.remove('bg-green-500');
            dom.startButtonMessage.classList.add('bg-red-500');
        }
    }

    if (dom.dockButtonMessage) {
        if (chargingSources === 'Docked') {
            dom.dockButtonMessage.innerText = 'Docked!';
            dom.dockButtonMessage.classList.remove('bg-red-500');
            dom.dockButtonMessage.classList.add('bg-green-500');
            if (dom.dockButtonChargingMessage) {
                if (chargeStatus === 'Not Charging') {
                    dom.dockButtonChargingMessage.innerText = 'Not Charging!';
                    dom.dockButtonChargingMessage.classList.remove('bg-green-500');
                    dom.dockButtonChargingMessage.classList.add('bg-red-500');
                } else {
                    dom.dockButtonChargingMessage.innerText = chargeStatus;
                    dom.dockButtonChargingMessage.classList.remove('bg-red-500');
                    dom.dockButtonChargingMessage.classList.add('bg-green-500');
                }
            }
        } else {
            dom.dockButtonMessage.innerText = 'Not Docked!';
            dom.dockButtonMessage.classList.remove('bg-green-500');
            dom.dockButtonMessage.classList.add('bg-red-500');
        }
    }

    if (sensorBlinker) {
        sensorBlinker.classList.toggle('bg-pink-400');
        sensorBlinker.classList.toggle('bg-black');
    }

    if (dom.bumpLeft && data.bumpLeft) {
        dom.bumpLeft.classList.remove('bg-black');
        dom.bumpLeft.classList.add('bg-yellow-500');
    } else if (dom.bumpLeft) {
        dom.bumpLeft.classList.remove('bg-yellow-500');
        dom.bumpLeft.classList.add('bg-black');
    }

    if (dom.bumpRight && data.bumpRight) {
        dom.bumpRight.classList.remove('bg-black');
        dom.bumpRight.classList.add('bg-yellow-500');
    } else if (dom.bumpRight) {
        dom.bumpRight.classList.remove('bg-yellow-500');
        dom.bumpRight.classList.add('bg-black');
    }

    if (dom.dropLeft && data.wheelDropLeft) {
        dom.dropLeft.classList.remove('bg-black');
        dom.dropLeft.classList.add('bg-yellow-500');
    } else if (dom.dropLeft) {
        dom.dropLeft.classList.remove('bg-yellow-500');
        dom.dropLeft.classList.add('bg-black');
    }

    if (dom.dropRight && data.wheelDropRight) {
        dom.dropRight.classList.remove('bg-black');
        dom.dropRight.classList.add('bg-yellow-500');
    } else if (dom.dropRight) {
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
    if (!el) return;

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

socket.on('system-stats', data => {
    if (dom.cpuUsage) dom.cpuUsage.textContent = `CPU: ${data.cpu}%`;
    if (dom.memoryUsage) dom.memoryUsage.textContent = `RAM: ${data.memory}%`;
});
