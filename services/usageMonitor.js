const fs = require('fs');
const path = require('path');

const eventBus = require('../globals/eventBus');
const { createLogger } = require('../helpers/logger');
const { alertAdmins } = require('./discordBot');

const logger = createLogger('UsageMonitor');

const DAILY_METRIC_KEYS = ['dockings', 'undockings', 'driverAssignments', 'driverSkips'];
const DOCK_CHARGE_DEBOUNCE_MS = 5_000;
const DIVIDE_STRING = '=====================================================================';
const DATA_PATH = path.join(__dirname, '..', 'runtime', 'usageMetrics.json');

let metrics = createEmptyMetrics();
let uniqueDrivers = new Set();
let periodStartedAt = getStartOfDayTimestamp();
let summaryTimer = null;
let lastDockEventAt = 0;
let lastUndockEventAt = 0;
let persistQueue = Promise.resolve();

function createEmptyMetrics() {
  return DAILY_METRIC_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function sanitizeMetrics(raw = {}) {
  const cleaned = createEmptyMetrics();
  DAILY_METRIC_KEYS.forEach((key) => {
    const value = Number(raw[key]);
    cleaned[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  });
  return cleaned;
}

function getStartOfDayTimestamp(input = new Date()) {
  const date = input instanceof Date ? new Date(input) : new Date(input);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getStartOfNextDayTimestamp(input = new Date()) {
  const date = input instanceof Date ? new Date(input) : new Date(input);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date.getTime();
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

function persistState() {
  const payload = {
    periodStartedAt,
    metrics,
    uniqueDrivers: Array.from(uniqueDrivers),
  };
  const json = JSON.stringify(payload, null, 2);
  const dir = path.dirname(DATA_PATH);

  persistQueue = persistQueue
    .catch(() => {})
    .then(async () => {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(DATA_PATH, json, 'utf8');
      } catch (error) {
        logger.error('Failed to persist usage metrics state', error);
      }
    });

  return persistQueue;
}

function queuePersistState() {
  persistState().catch((error) => {
    logger.error('Failed to queue usage metrics persistence', error);
  });
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
  queuePersistState();
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
  queuePersistState();
  notifyAdmins(parts.join(' '));
}

function handleChargingStarted(payload = {}) {
  const eventTime = typeof payload.at === 'number' ? payload.at : Date.now();
  if (lastDockEventAt && eventTime - lastDockEventAt <= DOCK_CHARGE_DEBOUNCE_MS) {
    logger.debug('Skipping charging-started alert (recent dock event)');
    return;
  }
  const snapshot = formatBatterySnapshot(payload);
  const parts = ['[Usage]\n⚡ Charging started'];
  if (snapshot) {
    parts.push(`\n${snapshot}`);
  }
  if (eventTime) {
    parts.push(`\n${formatTimestamp(eventTime)}`);
  }
  parts.push(DIVIDE_STRING);
  queuePersistState();
  notifyAdmins(parts.join(' '));
}

function handleChargingStopped(payload = {}) {
  const eventTime = typeof payload.at === 'number' ? payload.at : Date.now();
  if (lastUndockEventAt && eventTime - lastUndockEventAt <= DOCK_CHARGE_DEBOUNCE_MS) {
    logger.debug('Skipping charging-stopped alert (recent undock event)');
    return;
  }
  const snapshot = formatBatterySnapshot(payload);
  const parts = ['[Usage]\n🔌 Charging stopped'];
  if (snapshot) {
    parts.push(`\n${snapshot}`);
  }
  if (eventTime) {
    parts.push(`\n${formatTimestamp(eventTime)}`);
  }
  parts.push(DIVIDE_STRING);
  queuePersistState();
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
  queuePersistState();
  // notifyAdmins(parts.join(' '));
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
  queuePersistState();
  // notifyAdmins(parts.join(' '));
}

function hasAnyActivity(metricsSnapshot = {}, driverIdsSnapshot = []) {
  const hasMetrics = DAILY_METRIC_KEYS.some((key) => Number(metricsSnapshot[key] ?? 0) > 0);
  return hasMetrics || (Array.isArray(driverIdsSnapshot) && driverIdsSnapshot.length > 0);
}

async function sendSummarySnapshot(startTimestamp, metricsSnapshot, driverIdsSnapshot) {
  const safeMetrics = metricsSnapshot ?? createEmptyMetrics();
  const safeDriverIds = Array.isArray(driverIdsSnapshot) ? driverIdsSnapshot : [];
  const totalDriverAssignments = safeMetrics.driverAssignments ?? 0;
  const uniqueDriverCount = new Set(safeDriverIds.filter((id) => typeof id === 'string' && id)).size;
  const lines = [
    '**📊 Daily usage summary**',
    `- 🕹️ Driver turns: ${totalDriverAssignments}${uniqueDriverCount ? ` (${uniqueDriverCount} unique)` : ''}`,
    `- 🧲 Dockings: ${safeMetrics.dockings ?? 0}`,
    `- 🚗 Undockings: ${safeMetrics.undockings ?? 0}`,
  ];
  if ((safeMetrics.driverSkips ?? 0) > 0) {
    lines.push(`- ⏭️ Driver skips: ${safeMetrics.driverSkips}`);
  }

  const startDate = new Date(startTimestamp);
  const endDate = new Date(getStartOfNextDayTimestamp(startTimestamp));
  lines.push(`Window: ${startDate.toLocaleString()} -> ${endDate.toLocaleString()}`);

  try {
    const sent = await alertAdmins(lines.join('\n'), { ping: false });
    if (!sent) {
      logger.debug('Daily usage summary not sent (client offline?)');
    }
  } catch (error) {
    logger.error('Failed to send daily usage summary', error);
  }
}

function loadStateFromDisk() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (Number.isFinite(parsed.periodStartedAt)) {
        periodStartedAt = parsed.periodStartedAt;
      }
      if (parsed.metrics && typeof parsed.metrics === 'object') {
        metrics = sanitizeMetrics(parsed.metrics);
      }
      if (Array.isArray(parsed.uniqueDrivers)) {
        uniqueDrivers = new Set(
          parsed.uniqueDrivers.filter((id) => typeof id === 'string' && id.trim())
        );
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error('Failed to load persisted usage metrics', error);
    }
  }

  const todayStart = getStartOfDayTimestamp();
  if (!Number.isFinite(periodStartedAt) || periodStartedAt <= 0) {
    periodStartedAt = todayStart;
  }

  // Align future-dated snapshots back to the current day.
  if (periodStartedAt > getStartOfNextDayTimestamp()) {
    periodStartedAt = todayStart;
  }

  metrics = sanitizeMetrics(metrics);
  uniqueDrivers = new Set(Array.from(uniqueDrivers));
}

function catchUpIfNeeded() {
  const todayStart = getStartOfDayTimestamp();

  if (periodStartedAt < todayStart) {
    const snapshotMetrics = { ...metrics };
    const snapshotDriverIds = Array.from(uniqueDrivers);
    const snapshotStart = periodStartedAt;

    periodStartedAt = todayStart;
    metrics = createEmptyMetrics();
    uniqueDrivers = new Set();
    queuePersistState();

    if (hasAnyActivity(snapshotMetrics, snapshotDriverIds)) {
      sendSummarySnapshot(snapshotStart, snapshotMetrics, snapshotDriverIds)
        .catch((error) => logger.error('Failed to dispatch catch-up usage summary', error));
    } else {
      logger.debug('Skipping catch-up summary due to no recorded activity');
    }
  } else if (periodStartedAt > todayStart) {
    periodStartedAt = todayStart;
    metrics = createEmptyMetrics();
    uniqueDrivers = new Set();
    queuePersistState();
  } else {
    queuePersistState();
  }
}

async function flushCurrentPeriod(nextPeriodStart) {
  const snapshotMetrics = { ...metrics };
  const snapshotDriverIds = Array.from(uniqueDrivers);
  const snapshotStart = periodStartedAt;

  const targetStart = Number.isFinite(nextPeriodStart)
    ? nextPeriodStart
    : getStartOfNextDayTimestamp(snapshotStart);

  periodStartedAt = targetStart;
  metrics = createEmptyMetrics();
  uniqueDrivers = new Set();
  await persistState();

  try {
    await sendSummarySnapshot(snapshotStart, snapshotMetrics, snapshotDriverIds);
  } catch (error) {
    logger.error('Failed to send scheduled daily usage summary', error);
  }
}

function scheduleDailySummary() {
  if (summaryTimer) {
    clearTimeout(summaryTimer);
    summaryTimer = null;
  }

  const now = Date.now();
  const nextPeriodStart = getStartOfNextDayTimestamp(now);
  const delay = Math.max(1_000, nextPeriodStart - now);

  summaryTimer = setTimeout(async () => {
    summaryTimer = null;
    try {
      await flushCurrentPeriod(nextPeriodStart);
    } finally {
      scheduleDailySummary();
    }
  }, delay);
}

function registerEventListeners() {
  eventBus.on('rover:docked', handleDocked);
  eventBus.on('rover:undocked', handleUndocked);
  eventBus.on('rover:charging-started', handleChargingStarted);
  eventBus.on('rover:charging-stopped', handleChargingStopped);
  eventBus.on('usage:driver-start', handleDriverStart);
  eventBus.on('usage:driver-skip', handleDriverSkip);
}

function initialize() {
  loadStateFromDisk();
  registerEventListeners();
  catchUpIfNeeded();
  scheduleDailySummary();
}

initialize();

function resetDailyMetricsForTesting(startTimestamp) {
  const targetStart = Number.isFinite(startTimestamp)
    ? getStartOfDayTimestamp(startTimestamp)
    : getStartOfDayTimestamp();
  periodStartedAt = targetStart;
  metrics = createEmptyMetrics();
  uniqueDrivers = new Set();
  return persistState();
}

module.exports = {
  _flushCurrentPeriod: flushCurrentPeriod,
  _resetDailyMetrics: resetDailyMetricsForTesting,
};
