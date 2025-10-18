import { socket } from '../modules/socketGlobal.js';

const BG_CLASSES = ['bg-red-600', 'bg-green-600', 'bg-yellow-500', 'bg-indigo-500'];
const TEXT_CLASSES = ['text-white', 'text-black'];
const CHARGING_STATUS_CODES = new Set([1, 2, 3, 4]);

const driveButton = document.querySelector('[data-mobile-action="drive"]');
const dockButton = document.querySelector('[data-mobile-action="dock"]');
const driveLabel = document.querySelector('[data-mobile-action-label="drive"]');
const dockLabel = document.querySelector('[data-mobile-action-label="dock"]');

function applyVisual(button, { background, text = 'text-white', pulse = false }) {
  if (!button) {
    return;
  }

  button.classList.remove(...BG_CLASSES, ...TEXT_CLASSES, 'animate-pulse');
  if (background) {
    button.classList.add(background);
  }
  if (text) {
    button.classList.add(text);
  }
  if (pulse) {
    button.classList.add('animate-pulse');
  }
}

function updateDriveStatus(data) {
  if (!driveButton) {
    return;
  }

  const oiMode = Number.isFinite(data?.oiMode) ? data.oiMode : null;
  const ready = oiMode === 4; // Full mode

  applyVisual(driveButton, {
    background: ready ? 'bg-green-600' : 'bg-red-600',
    text: 'text-white',
    pulse: ready,
  });

  if (driveLabel) {
    driveLabel.textContent = ready ? 'Ready' : 'Not Ready';
  }

  driveButton.setAttribute('aria-pressed', ready ? 'true' : 'false');
}

function updateDockStatus(data) {
  if (!dockButton) {
    return;
  }

  const chargeStatusIndex = Number.isFinite(data?.chargeStatus) ? data.chargeStatus : null;
  const docked = data?.chargingSources === 2;
  const charging = docked && chargeStatusIndex !== null && CHARGING_STATUS_CODES.has(chargeStatusIndex);

  if (!docked) {
    applyVisual(dockButton, {
      background: 'bg-indigo-500',
      text: 'text-white',
    });
    if (dockLabel) {
      dockLabel.textContent = 'Undocked';
    }
  } else if (charging) {
    applyVisual(dockButton, {
      background: 'bg-green-600',
      text: 'text-white',
      pulse: true,
    });
    if (dockLabel) {
      dockLabel.textContent = 'Docked & Charging';
    }
  } else {
    applyVisual(dockButton, {
      background: 'bg-yellow-500',
      text: 'text-black',
    });
    if (dockLabel) {
      dockLabel.textContent = 'Docked';
    }
  }

  dockButton.setAttribute('aria-pressed', docked ? 'true' : 'false');
}

function invokeGlobal(actionName) {
  const action = typeof window !== 'undefined' ? window[actionName] : null;
  if (typeof action === 'function') {
    action();
    return true;
  }
  return false;
}

function handleDriveClick(event) {
  event.preventDefault();
  if (!invokeGlobal('easyStart')) {
    socket.emit('easyStart');
  }
}

function handleDockClick(event) {
  event.preventDefault();
  if (!invokeGlobal('easyDock')) {
    socket.emit('easyDock');
  }
}

function initializeButtons() {
  if (driveButton) {
    driveButton.addEventListener('click', handleDriveClick);
  }

  if (dockButton) {
    dockButton.addEventListener('click', handleDockClick);
  }
}

function initializeSensorSync() {
  socket.on('SensorData', (data) => {
    updateDriveStatus(data);
    updateDockStatus(data);
  });
}

function init() {
  if (!driveButton && !dockButton) {
    return;
  }

  initializeButtons();
  initializeSensorSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
