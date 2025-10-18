import { socket } from '../modules/socketGlobal.js';

const BATTERY_CLASSES = ['bg-green-500', 'bg-yellow-500', 'bg-red-500'];

const batteryBars = Array.from(document.querySelectorAll('[data-battery-bar]'));
if (!batteryBars.length) {
  console.warn('[batteryBar] No elements found with [data-battery-bar].');
}

let batteryConfig = {
  capacity: 2068,
  warning: 1800,
  urgent: 1700,
};

let lastReading = null;

function clampPercent(percent) {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function determineAlertLevel(charge) {
  if (!Number.isFinite(charge)) {
    return 'normal';
  }
  if (charge <= batteryConfig.urgent) {
    return 'urgent';
  }
  if (charge <= batteryConfig.warning) {
    return 'warning';
  }
  return 'normal';
}

function applyBarColor(bar, level) {
  bar.classList.remove(...BATTERY_CLASSES);
  if (level === 'urgent') {
    bar.classList.add('bg-red-500');
  } else if (level === 'warning') {
    bar.classList.add('bg-yellow-500');
  } else {
    bar.classList.add('bg-green-500');
  }
}

function renderBatteryBars({ charge, capacity }) {
  if (!batteryBars.length) {
    return;
  }

  const safeCapacity =
    Number.isFinite(capacity) && capacity > 0 ? capacity : batteryConfig.capacity;
  const safeCharge = Number.isFinite(charge) ? Math.max(0, charge) : 0;
  const percent = clampPercent((safeCharge / safeCapacity) * 100);
  const level = determineAlertLevel(safeCharge);
  const formattedSummary = `${safeCharge}/${safeCapacity}`;

  batteryBars.forEach((bar) => {
    applyBarColor(bar, level);
    bar.style.width = `${percent}%`;
    bar.setAttribute('data-battery-percent', String(percent));
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(percent));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.textContent = `${percent}% (${formattedSummary})`;
  });
}

socket.on('batterybar:info', (data) => {
  if (!data) {
    return;
  }

  const { full, warning, urgent } = data;
  if (Number.isFinite(full) && full > 0) {
    batteryConfig.capacity = full;
  }
  if (Number.isFinite(warning)) {
    batteryConfig.warning = warning;
  }
  if (Number.isFinite(urgent)) {
    batteryConfig.urgent = urgent;
  }

  if (lastReading) {
    renderBatteryBars(lastReading);
  }
});

socket.on('SensorData', (data) => {
  if (!data) {
    return;
  }

  lastReading = {
    charge: Number.isFinite(data.batteryCharge) ? data.batteryCharge : null,
    capacity: Number.isFinite(data.batteryCapacity) ? data.batteryCapacity : batteryConfig.capacity,
  };

  renderBatteryBars(lastReading);
});
