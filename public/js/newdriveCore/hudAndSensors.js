import { socket } from '../modules/socketGlobal.js';

const MAX_VALUE = 300;
const MAX_VALUE_WCURRENT = 800;
const MAX_VALUE_CLIFF = 2700;

function groupByDataAttr(selector, attr) {
  return Array.from(document.querySelectorAll(selector)).reduce((acc, el) => {
    const key = el.getAttribute(attr);
    if (!key) {
      return acc;
    }
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(el);
    return acc;
  }, {});
}

const hudTextTargets = groupByDataAttr('[data-hud-text]', 'data-hud-text');
const hudRoleTargets = groupByDataAttr('[data-hud-role]', 'data-hud-role');
const hudBarTargets = groupByDataAttr('[data-hud-bar]', 'data-hud-bar');
const lightBumpTargets = groupByDataAttr('[data-hud-lightbump]', 'data-hud-lightbump');
const cliffTargets = groupByDataAttr('[data-hud-cliff]', 'data-hud-cliff');
const contactTargets = groupByDataAttr('[data-hud-contact]', 'data-hud-contact');
const driveStatusTargets = groupByDataAttr('[data-drive-status]', 'data-drive-status');
const driveButtonTargets = groupByDataAttr('[data-drive-button]', 'data-drive-button');

const sensorBlinkers = hudRoleTargets['sensor-blinker'] || [];
const chargeWarnings = hudRoleTargets['charge-warning'] || [];
const overcurrentWarnings = hudRoleTargets['overcurrent-warning'] || [];

function setText(key, value) {
  (hudTextTargets[key] || []).forEach((el) => {
    el.textContent = value;
  });
}

function updateChargeAlertOverlay(alertPayload) {
  if (!chargeWarnings.length) return;
  if (alertPayload && alertPayload.active && alertPayload.message) {
    chargeWarnings.forEach((el) => {
      el.textContent = alertPayload.message;
      el.classList.remove('hidden');
    });
  } else {
    chargeWarnings.forEach((el) => {
      el.textContent = '';
      el.classList.add('hidden');
    });
  }
}

const bumpKeys = ['L', 'FL', 'CL', 'CR', 'FR', 'R'];

function getMaxForRange(value) {
  if (value < 100) return 100;
  if (value < 500) return 500;
  if (value < 1000) return 1000;
  if (value < 1500) return 1500;
  return 2000;
}

function updateLightBumpSensors(bumpValues = []) {
  bumpKeys.forEach((key, index) => {
    const value = Number.isFinite(bumpValues[index]) ? bumpValues[index] : 0;
    const elements = lightBumpTargets[key] || [];
    if (!elements.length) return;

    const max = getMaxForRange(value);
    const widthPercent = (value / max) * 100;
    const newColor = `hsl(${max / 2}, 100%, 50%)`;

    elements.forEach((el) => {
      const previousWidth = parseFloat(el.style.width || '0');
      if (Math.abs(previousWidth - widthPercent) <= 1) {
        return;
      }
      el.style.width = `${widthPercent}%`;
      el.style.backgroundColor = newColor;
    });
  });
}

function updateCliffSensors(cliffValues = []) {
  const cliffKeys = ['L', 'FL', 'FR', 'R'];
  cliffKeys.forEach((key, index) => {
    const value = Number.isFinite(cliffValues[index]) ? cliffValues[index] : 0;
    (cliffTargets[key] || []).forEach((el) => {
      el.style.height = `${(value / MAX_VALUE_CLIFF) * 100}%`;
    });
  });
}

function updateContactSensorState(key, isActive) {
  const elements = contactTargets[key] || [];
  if (!elements.length) return;
  elements.forEach((el) => {
    el.classList.toggle('bg-yellow-500', Boolean(isActive));
    el.classList.toggle('bg-black', !isActive);
  });
}

function updateOvercurrentWarning(activeNames) {
  if (!overcurrentWarnings.length) return;
  if (activeNames.length) {
    overcurrentWarnings.forEach((el) => {
      el.textContent = `OVERCURRENT\n${activeNames.join('\n')}`;
      el.classList.remove('hidden');
    });
  } else {
    overcurrentWarnings.forEach((el) => {
      el.textContent = '';
      el.classList.add('hidden');
    });
  }
}

function setBarHeight(key, value, max) {
  (hudBarTargets[key] || []).forEach((el) => {
    el.style.height = `${(value / max) * 100}%`;
  });
}

function updateDriveReadyState(oiMode) {
  const isReady = oiMode === 'Full';
  const startMessages = driveStatusTargets['start-message'] || [];
  const startButtons = driveButtonTargets['start'] || [];

  startMessages.forEach((el) => {
    el.textContent = isReady ? 'Ready to Drive!' : 'Not in Driving Mode!';
    el.classList.toggle('bg-green-500', isReady);
    el.classList.toggle('bg-red-500', !isReady);
  });
  startButtons.forEach((el) => {
    el.classList.toggle('bg-green-600', isReady);
    el.classList.toggle('bg-red-600', !isReady);
  });
}

function updateDockStatus(chargingSources, chargeStatus) {
  const isDocked = chargingSources === 'Docked';
  const dockMessages = driveStatusTargets['dock-message'] || [];
  const dockChargeMessages = driveStatusTargets['dock-charge-message'] || [];
  const dockButtons = driveButtonTargets['dock'] || [];

  dockMessages.forEach((el) => {
    el.textContent = isDocked ? 'Docked!' : 'Not Docked!';
    el.classList.toggle('bg-green-500', isDocked);
    el.classList.toggle('bg-red-500', !isDocked);
  });

  dockChargeMessages.forEach((el) => {
    if (isDocked) {
      const isNotCharging = chargeStatus === 'Not Charging';
      el.textContent = isNotCharging ? 'Not Charging!' : chargeStatus;
      el.classList.toggle('bg-green-500', !isNotCharging);
      el.classList.toggle('bg-red-500', isNotCharging);
    } else {
      el.textContent = 'Not Charging!';
      el.classList.remove('bg-green-500');
      el.classList.add('bg-red-500');
    }
  });

  dockButtons.forEach((el) => {
    el.classList.toggle('bg-green-600', isDocked);
    el.classList.toggle('bg-red-600', !isDocked);
    el.classList.toggle('bg-indigo-600', !isDocked);
  });
}

socket.on('SensorData', (data = {}) => {
  const chargeStatusIndex = typeof data.chargeStatus === 'number' ? data.chargeStatus : 0;
  const chargeStatus =
    ['Not Charging', 'Reconditioning Charging', 'Full Charging', 'Trickle Charging', 'Waiting', 'Charging Error'][chargeStatusIndex] ||
    'Unknown';
  const chargingSources = data.chargingSources === 2 ? 'Docked' : 'None';
  const oiMode = data.oiMode === 2 ? 'Passive' : data.oiMode === 4 ? 'Full' : 'Safe';

  setText('oi-mode', `Mode: ${oiMode}`);
  setText('dock-status', `Dock: ${chargingSources}`);
  setText('charge-status', `Charging: ${chargeStatus}`);

  const voltageForDisplay =
    typeof data.batteryVoltageFiltered === 'number' && data.batteryVoltageFiltered > 0
      ? data.batteryVoltageFiltered
      : data.batteryVoltage;
  setText('battery-usage', `Charge: ${data.batteryCharge} / ${data.batteryCapacity}`);
  setText('battery-voltage', `Voltage: ${voltageForDisplay / 1000}V`);
  setText('brush-current', `Side Brush: ${data.brushCurrent}mA`);
  setText('battery-current', `Current: ${data.batteryCurrent}mA`);
  setText('main-brush-current', `Main Brush: ${data.mainBrushCurrent}mA`);
  setText('dirt-detect', `Dirt Detect: ${data.dirtDetect}`);

  updateChargeAlertOverlay(data.chargeAlert);

  const overcurrentNames = {
    leftWheel: 'Left Wheel',
    rightWheel: 'Right Wheel',
    mainBrush: 'Main Brush',
    sideBrush: 'Side Brush',
  };
  const activeOvercurrents = Object.entries(data.overcurrents || {})
    .filter(([, state]) => state === 'ON')
    .map(([key]) => overcurrentNames[key])
    .filter(Boolean);

  updateOvercurrentWarning(activeOvercurrents);
  setText('overcurrent-status', activeOvercurrents.length ? `Overcurrent: ${activeOvercurrents.join(', ')}` : 'Overcurrent: none');

  updateLightBumpSensors(data.bumpSensors);
  updateCliffSensors(data.cliffSensors);
  setBarHeight('left-current', data.leftCurrent || 0, MAX_VALUE_WCURRENT);
  setBarHeight('right-current', data.rightCurrent || 0, MAX_VALUE_WCURRENT);

  updateDriveReadyState(oiMode);
  updateDockStatus(chargingSources, chargeStatus);

  if (sensorBlinkers.length) {
    sensorBlinkers.forEach((el) => {
      el.classList.toggle('bg-pink-400');
      el.classList.toggle('bg-black');
    });
  }

  updateContactSensorState('bump-left', data.bumpLeft);
  updateContactSensorState('bump-right', data.bumpRight);
  updateContactSensorState('drop-left', data.wheelDropLeft);
  updateContactSensorState('drop-right', data.wheelDropRight);
});

socket.on('system-stats', (data = {}) => {
  setText('cpu-usage', `CPU: ${data.cpu}%`);
  setText('memory-usage', `RAM: ${data.memory}%`);
});
