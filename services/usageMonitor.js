const eventBus = require('../globals/eventBus');
const { createLogger } = require('../helpers/logger');
const { alertAdmins } = require('./discordBot');

const logger = createLogger('UsageMonitor');

const DAILY_METRIC_KEYS = ['dockings', 'undockings', 'driverAssignments', 'driverSkips'];
const DOCK_CHARGE_DEBOUNCE_MS = 5_000;
const DIVIDE_STRING = '====================================================================='

let metrics = createEmptyMetrics();
let uniqueDrivers = new Set();
let periodStartedAt = Date.now();
let summaryTimer = null;
let lastDockEventAt = 0;
let lastUndockEventAt = 0;

function createEmptyMetrics() {
  return DAILY_METRIC_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function formatTimestamp(ms) {
  try {
    return new Date(ms).toLocaleTimeString('en-US', { hour12: false });
  } catch (error) {
    logger.debug('Failed to format timestamp', error);
    return new Date(ms).toISOString();
  }
}

function formatBatterySnapshot(payload = {}) {
  const summary = typeof payload.summary === 'string' && payload.summary.trim()
    ? payload.summary.trim()
    : null;
  const voltage = Number.isFinite(payload.batteryVoltage) ? `${payload.batteryVoltage}mV` : null;
  const current = Number.isFinite(payload.batteryCurrent) ? `${payload.batteryCurrent}mA` : null;
  const pieces = [];
  if (summary) pieces.push(`charge ${summary}`);
  if (voltage) pieces.push(`voltage ${voltage}`);
  if (current) pieces.push(`current ${current}`);
  return pieces.length > 0 ? pieces.join(', ') : null;
}

function notifyAdmins(message) {
  Promise.resolve(alertAdmins(message, { ping: false }))
    .then((sent) => {
      if (!sent) {
        logger.debug(`Alert not sent (client offline?): ${message}`);
      }
    })
    .catch((error) => {
      logger.error('Failed to notify admins about usage event', error);
    });
}

function handleDocked(payload = {}) {
  metrics.dockings += 1;
  const eventTime = typeof payload.at === 'number' ? payload.at : Date.now();
  lastDockEventAt = eventTime;
  const snapshot = formatBatterySnapshot(payload);
  const parts = [
    '[Usage]\n🧲 Rover docked',
    payload.isCharging ? '(charging)' : '(not charging)',
  ];
  if (snapshot) {
    parts.push(`\n${snapshot}`);
  }
  if (eventTime) {
    parts.push(`\n${formatTimestamp(eventTime)}`);
  }
  parts.push(DIVIDE_STRING);
  notifyAdmins(parts.join(' '));
}

function handleUndocked(payload = {}) {
  metrics.undockings += 1;
  const eventTime = typeof payload.at === 'number' ? payload.at : Date.now();
  lastUndockEventAt = eventTime;
  const snapshot = formatBatterySnapshot(payload);
  const parts = ['[Usage]\n🚗 Rover undocked'];
  if (snapshot) {
    parts.push(`\n${snapshot}`);
  }
  if (eventTime) {
    parts.push(`\n${formatTimestamp(eventTime)}`);
  }
  parts.push(DIVIDE_STRING);
  notifyAdmins(parts.join(' '));
}

function handleChargingStarted(payload = {}) {
  const eventTime = typeof payload.at === 'number' ? payload.at : Date.now();
  // if (lastDockEventAt && eventTime - lastDockEventAt <= DOCK_CHARGE_DEBOUNCE_MS) {
  //   logger.debug('Skipping charging-started alert (recent dock event)');
  //   return;
  // }
  const snapshot = formatBatterySnapshot(payload);
  const parts = ['[Usage]\n⚡ Charging started'];
  if (snapshot) {
    parts.push(`\n${snapshot}`);
  }
  if (eventTime) {
    parts.push(`\n${formatTimestamp(eventTime)}`);
  }
  parts.push(DIVIDE_STRING);
  notifyAdmins(parts.join(' '));
}

function handleChargingStopped(payload = {}) {
  const eventTime = typeof payload.at === 'number' ? payload.at : Date.now();
  // if (lastUndockEventAt && eventTime - lastUndockEventAt <= DOCK_CHARGE_DEBOUNCE_MS) {
  //   logger.debug('Skipping charging-stopped alert (recent undock event)');
  //   return;
  // }
  const snapshot = formatBatterySnapshot(payload);
  const parts = ['[Usage]\n🔌 Charging stopped'];
  if (snapshot) {
    parts.push(`\n${snapshot}`);
  }
  if (eventTime) {
    parts.push(`\n${formatTimestamp(eventTime)}`);
  }
  parts.push(DIVIDE_STRING);
  notifyAdmins(parts.join(' '));
}

function handleDriverStart(payload = {}) {
  metrics.driverAssignments += 1;
  const driverId = typeof payload.driverId === 'string' ? payload.driverId : null;
  if (driverId) {
    uniqueDrivers.add(driverId);
  }
  const label = payload.nickname || (driverId ? `Driver ${driverId.slice(-4)}` : 'Unknown driver');
  const parts = [`[Usage]\n🕹️ Driver turn started: ${label}`];
  if (typeof payload.queueDepth === 'number') {
    parts.push(`\nqueue depth ${payload.queueDepth}`);
  }
  if (payload.at) {
    parts.push(`\n${formatTimestamp(payload.at)}`);
  }
  parts.push(DIVIDE_STRING);
  notifyAdmins(parts.join(' '));
}

function handleDriverSkip(payload = {}) {
  metrics.driverSkips += 1;
  const driverId = typeof payload.driverId === 'string' ? payload.driverId : null;
  const label = payload.nickname || (driverId ? `Driver ${driverId.slice(-4)}` : 'Unknown driver');
  const reason = payload.reason ? `reason: ${payload.reason}` : null;
  const parts = [`[Usage]\n⏭️ Driver skipped: ${label}`];
  if (reason) {
    parts.push(`\n${reason}`);
  }
  if (payload.at) {
    parts.push(`\n${formatTimestamp(payload.at)}`);
  }
  parts.push(DIVIDE_STRING);
  notifyAdmins(parts.join(' '));
}

function resetDailyMetrics() {
  metrics = createEmptyMetrics();
  uniqueDrivers = new Set();
  periodStartedAt = Date.now();
}

async function sendDailySummary() {
  const totalDriverAssignments = metrics.driverAssignments;
  const uniqueDriverCount = uniqueDrivers.size;
  const lines = [
    '**📊 Daily usage summary**',
    `- 🕹️ Driver turns: ${totalDriverAssignments}${uniqueDriverCount ? ` (${uniqueDriverCount} unique)` : ''}`,
    `- 🧲 Dockings: ${metrics.dockings}`,
    `- 🚗 Undockings: ${metrics.undockings}`,
  ];
  if (metrics.driverSkips > 0) {
    lines.push(`- ⏭️ Driver skips: ${metrics.driverSkips}`);
  }
  const startedAt = new Date(periodStartedAt);
  lines.push(`Window: ${startedAt.toLocaleString()} -> ${new Date().toLocaleString()}`);

  try {
    const sent = await alertAdmins(lines.join('\n'), { ping: false });
    if (!sent) {
      logger.debug('Daily usage summary not sent (client offline?)');
    }
  } catch (error) {
    logger.error('Failed to send daily usage summary', error);
  }
}

function scheduleDailySummary() {
  if (summaryTimer) {
    clearTimeout(summaryTimer);
    summaryTimer = null;
  }

  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const delay = Math.max(1_000, next.getTime() - now.getTime());

  summaryTimer = setTimeout(async () => {
    await sendDailySummary();
    resetDailyMetrics();
    scheduleDailySummary();
  }, delay);
}

eventBus.on('rover:docked', handleDocked);
eventBus.on('rover:undocked', handleUndocked);
eventBus.on('rover:charging-started', handleChargingStarted);
eventBus.on('rover:charging-stopped', handleChargingStopped);
// eventBus.on('usage:driver-start', handleDriverStart);
// eventBus.on('usage:driver-skip', handleDriverSkip);

resetDailyMetrics();
scheduleDailySummary();

module.exports = {
  _resetDailyMetrics: resetDailyMetrics,
};
