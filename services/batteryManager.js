const { createLogger } = require('../helpers/logger');
const { io } = require('../globals/wsSocketExpress');
const turnHandler = require('./turnHandler');
const roombaStatus = require('../globals/roombaStatus');
const accessControl = require('./accessControl');
const config = require('../helpers/config');
const { port, tryWrite } = require('../globals/serialConnection');
const { alertAdmins, announceDoneCharging } = require('./discordBot');

const logger = createLogger('Battery');

const WARNING_THRESHOLD = 1700;
const URGENT_THRESHOLD = 1650;
const CHARGING_STATUS_CODES = new Set([1, 2, 3, 4]);
const DEFAULT_AUTOCHARGE_TIMEOUT_MS = 5_000;

const ioRef = io;
const turnHandlerRef = turnHandler;
const roombaStatusRef = roombaStatus;
const alertAdminsFn = config.discordBot?.enabled ? alertAdmins : null;

ioRef.on('connection', (socket) => {
    socket.emit('batterybar:info', {full: roombaStatusRef.batteryCapacity, warning: WARNING_THRESHOLD, urgent: URGENT_THRESHOLD});
});

const batteryState = {
    needsCharge: false,
    alertLevel: 'normal',
    chargingNotified: false,
};

let autoChargeState = null;

const triggerDockCommandFn = () => {
    try {
        tryWrite(port, [143]);
    } catch (error) {
        logger.error('Failed to write dock command to serial port', error);
    }
};

function calculateBatteryPercentage(charge, capacity) {
    if (!Number.isFinite(charge) || !Number.isFinite(capacity) || capacity <= 0) {
        return 0;
    }
    const percent = Math.round((charge / capacity) * 100);
    return Math.max(0, Math.min(100, percent));
}

function determineAlertLevel(charge) {
    if (!Number.isFinite(charge)) {
        return 'normal';
    }
    if (charge <= URGENT_THRESHOLD) {
        return 'urgent';
    }
    if (charge <= WARNING_THRESHOLD) {
        return 'warning';
    }
    return 'normal';
}

function isFullyCharged(charge, capacity) {
    if (!Number.isFinite(charge) || !Number.isFinite(capacity) || capacity <= 0) {
        return false;
    }
    return charge >= capacity;
}

function formatBatterySummary(charge, capacity) {
    // const percentage = calculateBatteryPercentage(charge, capacity);
    const safeCharge = Number.isFinite(charge) ? charge : 0;
    const safeCapacity = Number.isFinite(capacity) ? capacity : 0;
    return `${safeCharge}/${safeCapacity}`;
}

function isTurnsModeActive() {
    return accessControl?.state?.mode === 'turns';
}

function ensureTurnPause() {
    if (!turnHandlerRef || typeof turnHandlerRef.setChargingPause !== 'function') {
        return;
    }

    if (!turnHandlerRef.isChargingPauseActive || !turnHandlerRef.getChargingPauseReason) {
        turnHandlerRef.setChargingPause('battery-charging');
        return;
    }

    if (!turnHandlerRef.isChargingPauseActive()) {
        turnHandlerRef.setChargingPause('battery-charging');
        return;
    }

    if (turnHandlerRef.getChargingPauseReason() !== 'battery-charging') {
        turnHandlerRef.setChargingPause('battery-charging');
    }
}

function clearTurnPauseIfNeeded() {
    if (!turnHandlerRef || typeof turnHandlerRef.isChargingPauseActive !== 'function') {
        return;
    }

    if (!turnHandlerRef.isChargingPauseActive()) {
        return;
    }

    const reason = typeof turnHandlerRef.getChargingPauseReason === 'function'
        ? turnHandlerRef.getChargingPauseReason()
        : null;

    if (!reason || reason === 'battery-charging') {
        turnHandlerRef.clearChargingPause();
    }
}

function sendAlertForLevel(level, summary) {
    const prefix = level === 'urgent' ? 'Battery urgent' : 'Battery warning';
    const message = `${prefix} (${summary}). Please dock the rover and keep it charging.`;

    logger.warn(`${prefix.toUpperCase()}: ${summary}`);
    ioRef.emit('alert', message);
    ioRef.emit('message', message);

    if ((level === 'urgent' || level === 'warning') && typeof alertAdminsFn === 'function') {
        alertAdminsFn(`[Roomba Rover] ${message}`).catch((error) => {
            logger.error('Failed to alert Discord admins about urgent battery state', error);
        });
    }
}

function sendChargingNotice(summary, turnsModeActive) {
    const message = turnsModeActive
        ? `Battery charging (${summary}). Turns are paused until the battery is full.`
        : `Battery charging (${summary}). Please leave the rover docked until it finishes.`;

    logger.info(`Charging detected: ${summary} | turns mode active: ${turnsModeActive}`);
    ioRef.emit('alert', message);
    ioRef.emit('message', message);
}

function sendRecoveredNotice(summary, turnsModeActive) {
    const message = turnsModeActive
        ? `Battery fully charged (${summary}). Turns have resumed.`
        : `Battery fully charged (${summary}).`;

    logger.info(`Battery recovered to full charge: ${summary}`);
    ioRef.emit('alert', message);
    ioRef.emit('message', message);
}

function enterLowBatteryState(level, { summary, isCharging }) {
    batteryState.needsCharge = true;
    batteryState.alertLevel = level;
    batteryState.chargingNotified = false;

    sendAlertForLevel(level, summary);

    if (isCharging) {
        batteryState.chargingNotified = true;
        sendChargingNotice(summary, isTurnsModeActive());
    }
}

function handleBatteryRecovered(summary) {
    const turnsModeActive = isTurnsModeActive();

    batteryState.needsCharge = false;
    batteryState.alertLevel = 'normal';
    batteryState.chargingNotified = false;

    sendRecoveredNotice(summary, turnsModeActive);
    clearTurnPauseIfNeeded();

    if (typeof announceDoneCharging === 'function') {
        try {
            announceDoneCharging();
        } catch (error) {
            logger.error('Failed to announce done charging', error);
        }
    }
}

function maybeEscalateAlert(levelFromCharge, summary) {
    if (levelFromCharge === 'urgent' && batteryState.alertLevel !== 'urgent') {
        batteryState.alertLevel = 'urgent';
        sendAlertForLevel('urgent', summary);
        return;
    }

    if (levelFromCharge === 'warning' && batteryState.alertLevel === 'urgent') {
        batteryState.alertLevel = 'warning';
    }
}

function maybeNotifyCharging(summary, isCharging) {
    if (!batteryState.needsCharge || !isCharging || batteryState.chargingNotified) {
        return;
    }

    batteryState.chargingNotified = true;
    ensureTurnPause();
    sendChargingNotice(summary, isTurnsModeActive());
}

function buildChargeAlert({ summary, isCharging, batteryCharge, batteryCapacity }) {
    const isFull = isFullyCharged(batteryCharge, batteryCapacity);

    if (isCharging) {
        return {
            active: false,
            state: isFull ? 'charged' : 'charging',
            message: isFull
                ? `Battery fully charged (${summary}).`
                : `Battery charging (${summary}).`,
        };
    }

    if (batteryState.needsCharge) {
        const level = batteryState.alertLevel === 'urgent' ? 'urgent' : 'warning';
        const message = level === 'urgent'
            ? `BATTERY URGENTLY LOW! (${summary}). DOCK AND CHARGE THE ROVER IMMEDIATLEY!!`
            : `Battery warning (${summary}). Please dock soon to charge!`;

        return {
            active: true,
            state: level,
            message,
        };
    }

    return {
        active: false,
        state: 'clear',
        message: '',
    };
}

function resetState() {
    batteryState.needsCharge = false;
    batteryState.alertLevel = 'normal';
    batteryState.chargingNotified = false;
}

function sendAutoChargeMessage(text) {
    if (!ioRef || !text) return;
    ioRef.emit('message', text);
}

function handleAutoCharge(now, { isDocked, isCharging }) {
    if (!autoChargeState) return;

    if (!autoChargeState.enabled || typeof triggerDockCommandFn !== 'function') {
        autoChargeState.dockIdleStartAt = null;
        return;
    }

    if (isDocked && !isCharging) {
        if (!autoChargeState.dockIdleStartAt) {
            autoChargeState.dockIdleStartAt = now;
            logger.info('Autocharge timer started (docked, not charging)');
            sendAutoChargeMessage('Autocharge timer started');
        } else if (now - autoChargeState.dockIdleStartAt >= autoChargeState.timeoutMs) {
            const elapsed = now - autoChargeState.dockIdleStartAt;
            logger.warn(`Autocharge timeout reached; issuing dock command | elapsed=${elapsed}ms docked=${isDocked} charging=${isCharging}`);
            triggerDockCommandFn();
            sendAutoChargeMessage('Autocharge command sent');
            autoChargeState.dockIdleStartAt = null;
        }
        return;
    }

    if (autoChargeState.dockIdleStartAt) {
        autoChargeState.dockIdleStartAt = null;
        logger.debug(`Autocharge timer reset (conditions cleared) | docked=${isDocked} charging=${isCharging}`);
        sendAutoChargeMessage('Autocharge timer reset');
    }
}

function handleSensorUpdate({
    chargeStatus,
    batteryCharge,
    batteryCapacity,
    batteryVoltage,
    chargingSources,
}) {
    const isCharging = CHARGING_STATUS_CODES.has(chargeStatus);
    const isDocked = chargingSources === 2;
    const alertLevelFromCharge = determineAlertLevel(batteryCharge);
    const batteryPercentage = calculateBatteryPercentage(batteryCharge, batteryCapacity);
    const summary = formatBatterySummary(batteryCharge, batteryCapacity);

    roombaStatusRef.docked = isDocked;
    roombaStatusRef.chargeStatus = isCharging;
    roombaStatusRef.batteryCharge = batteryCharge;
    roombaStatusRef.batteryCapacity = batteryCapacity;
    roombaStatusRef.batteryVoltage = batteryVoltage;
    roombaStatusRef.batteryFilteredVoltage = null;
    roombaStatusRef.batteryPercentage = batteryPercentage;

    if (!batteryState.needsCharge && alertLevelFromCharge !== 'normal') {
        enterLowBatteryState(alertLevelFromCharge, { summary, isCharging });
    } else if (batteryState.needsCharge) {
        if (isFullyCharged(batteryCharge, batteryCapacity)) {
            handleBatteryRecovered(summary);
        } else {
            maybeEscalateAlert(alertLevelFromCharge, summary);
            maybeNotifyCharging(summary, isCharging);

            if (!isCharging) {
                batteryState.chargingNotified = false;
                clearTurnPauseIfNeeded();
            }
        }
    } else {
        clearTurnPauseIfNeeded();
    }

    handleAutoCharge(Date.now(), { isDocked, isCharging });

    const chargeAlert = buildChargeAlert({
        summary,
        isCharging,
        batteryCharge,
        batteryCapacity,
    });

    return {
        batteryPercentage,
        filteredVoltage: null,
        chargeAlert,
    };
}

function configureAutoCharge() {
    const batteryConfig = config?.battery || {};
    const autoChargeConfig = batteryConfig.autoCharge || {};

    autoChargeState = {
        enabled: autoChargeConfig.enabled !== false,
        timeoutMs: Number.isFinite(autoChargeConfig.timeoutMs) && autoChargeConfig.timeoutMs >= 0
            ? autoChargeConfig.timeoutMs
            : DEFAULT_AUTOCHARGE_TIMEOUT_MS,
        dockIdleStartAt: null,
    };
}

function refreshConfig() {
    configureAutoCharge();
    resetState();
}

refreshConfig();

module.exports = {
    handleSensorUpdate,
    refreshConfig,
};
