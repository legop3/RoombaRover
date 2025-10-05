const { announceDoneCharging } = require('./discordBot');
const { createLogger } = require('./logger');

const logger = createLogger('Battery');

// Central battery/charging coordinator: filters sensor readings, pauses turns, and
// nudges the rover back onto its dock when needed.
const DEFAULT_ALERT_COOLDOWN_MS = 10 * 60_000; // delay between repeat low-battery alerts
const DEFAULT_DOCK_REMINDER_INTERVAL_MS = 2 * 60_000; // reminder cadence while still low
const DEFAULT_FILTER_ALPHA = 0.25; // exponential smoothing weight
const DEFAULT_EMPTY_VOLTAGE_MV = 13_200; // pack voltage treated as 0%
const DEFAULT_FULL_VOLTAGE_MV = 16_800; // pack voltage treated as 100%
const DEFAULT_LOW_THRESHOLD_MV = 14_400; // filtered voltage that triggers low battery
const DEFAULT_RECOVER_THRESHOLD_MV = 15_600; // retained for compatibility, not used for recovery
const DEFAULT_LOW_DEBOUNCE_MS = 1_500; // dwell time before honoring low-voltage state
const DEFAULT_CLEAR_DEBOUNCE_MS = 2_500; // dwell time before clearing warning
const DEFAULT_CLEAR_MARGIN_MV = 200; // hysteresis margin for voltage clears
const DEFAULT_FULL_CHARGE_RATIO = 0.98; // charge/capacity ratio that counts as full
const DEFAULT_AUTOCHARGE_TIMEOUT_MS = 10_000; // grace period before reissuing dock command
const BATTERY_ALARM_INTERVAL_MS = 5_000; // low-battery tone interval
const CHARGING_STATUS_CODES = new Set([1, 2, 3, 4]); // status bytes that indicate charging

let ioRef = null; // shared socket.io instance
let turnHandlerRef = null; // turn queue orchestrator
let roombaStatusRef = null; // mutable status snapshot shared with rest of app
let alertAdminsFn = null; // optional Discord notifier
let playLowBatteryToneFn = null; // callback that plays the Roomba tone
let accessControlStateRef = null; // needed to know if turns mode is active
let triggerDockCommandFn = null; // command sender for autocharge nudges
let stopAiControlLoopFn = null; // shuts down AI driving when we hit the dock

let thresholds = null; // tuned config values with defaults baked in
let batteryVoltageTrend = null; // filtered voltage tracking & debounce timers
let batteryState = null; // derived state (needs charge, alerts, pause, etc.)
let batteryAlarmTimer = null; // interval handle for repeating alerts
let autoChargeState = null; // dock-idle timer bookkeeping

// Utility: clamp to a safe numeric range.
function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

// UI percentage stays voltage-derived so it matches the legacy behaviour.
function calculateBatteryPercentage(charge, capacity, voltage) {
    const emptyVoltage = thresholds?.emptyVoltageMv ?? DEFAULT_EMPTY_VOLTAGE_MV;
    const fullVoltage = thresholds?.fullVoltageMv ?? DEFAULT_FULL_VOLTAGE_MV;
    const voltageValue = Number.isFinite(voltage) ? voltage : emptyVoltage;
    const clampedVoltage = clampNumber(voltageValue, emptyVoltage, fullVoltage);
    const range = Math.max(1, fullVoltage - emptyVoltage);
    const fraction = (clampedVoltage - emptyVoltage) / range;
    return Math.round(clampNumber(fraction, 0, 1) * 100);
}

// Smooth incoming voltage samples and maintain low/high dwell timers.
function updateBatteryVoltageTrend(voltageMv) {
    const now = Date.now();

    if (!Number.isFinite(voltageMv) || voltageMv <= 0) {
        return batteryVoltageTrend;
    }

    if (!Number.isFinite(batteryVoltageTrend.filteredVoltage)) {
        batteryVoltageTrend.filteredVoltage = voltageMv;
    } else {
        const previous = batteryVoltageTrend.filteredVoltage;
        batteryVoltageTrend.filteredVoltage = Math.round(
            (previous * (1 - thresholds.filterAlpha)) + (voltageMv * thresholds.filterAlpha)
        );
    }

    const filteredVoltage = batteryVoltageTrend.filteredVoltage;
    const clearThreshold = thresholds.lowVoltageMv + thresholds.clearMarginMv;

    if (filteredVoltage <= thresholds.lowVoltageMv) {
        if (!batteryVoltageTrend.lowSince) batteryVoltageTrend.lowSince = now;
        batteryVoltageTrend.highSince = 0;
    } else if (filteredVoltage >= clearThreshold) {
        if (!batteryVoltageTrend.highSince) batteryVoltageTrend.highSince = now;
        batteryVoltageTrend.lowSince = 0;
    } else {
        batteryVoltageTrend.highSince = 0;
    }

    const lowDuration = batteryVoltageTrend.lowSince ? now - batteryVoltageTrend.lowSince : 0;
    const highDuration = batteryVoltageTrend.highSince ? now - batteryVoltageTrend.highSince : 0;

    if (lowDuration >= thresholds.lowDebounceMs) {
        batteryVoltageTrend.displayWarning = true;
    } else if (highDuration >= thresholds.clearDebounceMs) {
        batteryVoltageTrend.displayWarning = false;
    }

    batteryVoltageTrend.lastSampleAt = now;
    return batteryVoltageTrend;
}

function formatBatterySummary(percent, voltage) {
    const voltageDisplay = Number.isFinite(voltage) ? (voltage / 1000).toFixed(2) : '0.00';
    const percentDisplay = Number.isFinite(percent) ? percent : 0;
    return `${percentDisplay}% / ${voltageDisplay}V`;
}

// Push a low-battery alert (and optional Discord ping) to operators.
function notifyBatteryLow(percent, voltage) {
    const summary = formatBatterySummary(percent, voltage);
    const message = `Battery low (${summary}). Please dock the rover to charge.`;
    logger.warn(`Low battery detected: ${summary}`);
    ioRef.emit('alert', message);

    if (typeof alertAdminsFn === 'function') {
        alertAdminsFn(`[Roomba Rover] ${message}`).catch((error) => {
            logger.error('Failed to alert Discord admins about low battery', error);
        });
    }
}

// Broadcast that charging has started and turns are paused if needed.
function notifyChargingPause(percent, voltage, turnsModeActive) {
    const summary = formatBatterySummary(percent, voltage);
    const message = turnsModeActive
        ? `Battery charging (${summary}). Turns are paused until charging completes.`
        : `Battery charging (${summary}). Please keep the rover docked until it finishes.`;
    logger.info(`Charging detected: ${summary} | turns mode active: ${turnsModeActive}`);
    ioRef.emit('alert', message);
    ioRef.emit('message', message);
}

// Gentle nag when we are still low and not charging yet.
function notifyDockReminder(percent, voltage) {
    const summary = formatBatterySummary(percent, voltage);
    const message = `Battery still low (${summary}). Please dock the rover as soon as possible.`;
    logger.info(`Dock reminder triggered: ${summary}`);
    ioRef.emit('alert', message);
}

// Let everyone know the rover is charged and turns can resume.
function notifyBatteryRecovered(percent, voltage, turnsModeActive) {
    const summary = formatBatterySummary(percent, voltage);
    const message = turnsModeActive
        ? `Battery recovered (${summary}). Turns have resumed.`
        : `Battery recovered (${summary}).`;
    logger.info(`Battery recovered: ${summary} | turns mode active: ${turnsModeActive}`);
    ioRef.emit('alert', message);
    ioRef.emit('message', message);
}

// Relay rover-status chatter to the UI log.
function sendAutoChargeMessage(text) {
    if (!ioRef || !text) return;
    ioRef.emit('message', text);
}

// Mirrors the legacy autocharge helper: if the rover sits docked but idle we
// reissue the dock command after a short grace period.
function handleAutoCharge(now, { isDocked, isCharging }) {
    if (!autoChargeState) return;

    if (isDocked && typeof stopAiControlLoopFn === 'function') {
        try {
            stopAiControlLoopFn();
        } catch (error) {
            logger.error('Failed to stop AI control loop during autocharge', error);
        }
    }

    if (!autoChargeState.enabled || typeof triggerDockCommandFn !== 'function') {
        autoChargeState.dockIdleStartAt = null;
        return;
    }

    if (isDocked && !isCharging) {
        if (!autoChargeState.dockIdleStartAt) {
            autoChargeState.dockIdleStartAt = now;
            logger.info('Autocharge timer started (docked, not charging)');
            sendAutoChargeMessage('Autocharging timer started');
        } else if (now - autoChargeState.dockIdleStartAt >= autoChargeState.timeoutMs) {
            logger.warn('Autocharge timeout reached; issuing dock command');
            try {
                triggerDockCommandFn();
            } catch (error) {
                logger.error('Failed to send autocharge dock command', error);
            }
            sendAutoChargeMessage('Autocharging initiated');
            autoChargeState.dockIdleStartAt = null;
        }
        return;
    }

    if (autoChargeState.dockIdleStartAt) {
        autoChargeState.dockIdleStartAt = null;
        logger.debug('Autocharge timer reset (conditions cleared)');
        sendAutoChargeMessage('Resetting autocharge timer');
    }
}

// Helper to avoid poking turn handler if we are not in turns mode.
function isTurnsModeActive() {
    return accessControlStateRef?.mode === 'turns';
}

// Enforce a pause in the turns queue while we charge on the dock.
function ensureTurnPause(turnsModeActive) {
    if (!turnsModeActive || !turnHandlerRef || typeof turnHandlerRef.setChargingPause !== 'function') {
        return;
    }

    if (!turnHandlerRef.isChargingPauseActive || !turnHandlerRef.getChargingPauseReason) {
        // Minimal safety: best effort pause even if helper methods missing
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

// Resume turns once the battery system gives us the all clear.
function clearTurnPauseIfNeeded() {
    if (!turnHandlerRef || typeof turnHandlerRef.isChargingPauseActive !== 'function') return;
    if (!turnHandlerRef.isChargingPauseActive()) return;

    const reason = typeof turnHandlerRef.getChargingPauseReason === 'function'
        ? turnHandlerRef.getChargingPauseReason()
        : null;

    if (!reason || reason === 'battery-charging') {
        turnHandlerRef.clearChargingPause();
    }
}

// Main state machine: decides when to alert, pause, resume, or nag operators.
function evaluateBatteryState({ now, percent, filteredVoltage, isCharging, isDocked, chargeFraction }) {
    let warningActive = Boolean(batteryVoltageTrend.displayWarning);
    const turnsModeActive = isTurnsModeActive();
    const reachedFullCharge = typeof chargeFraction === 'number' && chargeFraction >= thresholds.fullChargeRatio;

    if (reachedFullCharge && warningActive) {
        batteryVoltageTrend.displayWarning = false;
        warningActive = false;
    }

    if (warningActive && !batteryState.needsCharge) {
        batteryState.needsCharge = true;
        batteryState.lastDockReminderAt = now;
        batteryState.chargingPauseNotified = false;
        logger.warn(`Low battery state entered | percent=${percent} voltage=${filteredVoltage}`);
        if (!isCharging) {
            batteryState.lastAlertAt = now;
            notifyBatteryLow(percent, filteredVoltage);
        } else {
            batteryState.lastAlertAt = 0;
        }
    }

    if (batteryState.needsCharge && warningActive && !isCharging) {
        if (now - batteryState.lastAlertAt > thresholds.alertCooldownMs) {
            batteryState.lastAlertAt = now;
            logger.warn(`Low battery alert cooldown elapsed | percent=${percent} voltage=${filteredVoltage}`);
            notifyBatteryLow(percent, filteredVoltage);
        }
    }

    const recovered = batteryState.needsCharge && reachedFullCharge;

    if (recovered) {
        batteryState.needsCharge = false;
        batteryState.chargingPauseNotified = false;
        batteryState.lastResumeNoticeAt = now;
        logger.info(`Battery recovered above thresholds | percent=${percent} voltage=${filteredVoltage}`);
        // Add any custom "battery ready" announcement hooks here before we
        // resume turns; notifyBatteryRecovered handles the stock messaging.
        announceDoneCharging();
        notifyBatteryRecovered(percent, filteredVoltage, turnsModeActive);
        batteryVoltageTrend.displayWarning = false;
        clearTurnPauseIfNeeded();
        return;
    }

    if (!batteryState.needsCharge) {
        if (reachedFullCharge) {
            batteryState.chargingPauseNotified = false;
        }
        clearTurnPauseIfNeeded();

        // announce to discord when battery is ready
        // announceDoneCharging();
        return;
    }

    if (isDocked && isCharging) {
        ensureTurnPause(turnsModeActive);
        if (!batteryState.chargingPauseNotified) {
            logger.info(`Announcing charging pause | percent=${percent} voltage=${filteredVoltage}`);
            notifyChargingPause(percent, filteredVoltage, turnsModeActive);
            batteryState.chargingPauseNotified = true;
        }
        return;
    }

    clearTurnPauseIfNeeded();

    if (now - batteryState.lastDockReminderAt > thresholds.dockReminderIntervalMs) {
        batteryState.lastDockReminderAt = now;
        notifyDockReminder(percent, filteredVoltage);
    }

    batteryState.chargingPauseNotified = false;
}

// Build a compact payload the UI can render in the charge-warning banner.
function buildChargeAlertPayload({ chargeStatus, batteryCharge, batteryCapacity, batteryVoltage, voltageStats, chargeFraction }) {
    const displayVoltage = Number.isFinite(voltageStats?.filteredVoltage)
        ? voltageStats.filteredVoltage
        : batteryVoltage;
    const percent = calculateBatteryPercentage(batteryCharge, batteryCapacity, displayVoltage);
    const summary = formatBatterySummary(percent, displayVoltage);
    const isCharging = CHARGING_STATUS_CODES.has(chargeStatus);
    const isFullyCharged = typeof chargeFraction === 'number' && chargeFraction >= thresholds.fullChargeRatio;
    const shouldWarnNow = !isFullyCharged && Boolean(voltageStats?.displayWarning) && !isCharging;

    if (shouldWarnNow) {
        return {
            active: true,
            state: 'needs-charge',
            message: `Battery low (${summary}). Please dock the rover to charge.`
        };
    }

    if (isCharging) {
        return {
            active: false,
            state: isFullyCharged ? 'charged' : 'charging',
            message: isFullyCharged
                ? `Battery fully charged (${summary}).`
                : `Battery charging (${summary}). Please keep the rover docked until it finishes.`
        };
    }

    return {
        active: false,
        state: 'clear',
        message: ''
    };
}

// Periodically chirp the Roomba if we are low and undocked.
function batteryAlarmTick() {
    if (!playLowBatteryToneFn) return;
    const shouldAlarm = batteryState.needsCharge && !roombaStatusRef?.docked;

    if (shouldAlarm && !batteryState.alarmActive) {
        batteryState.alarmActive = true;
        logger.debug('Playing low-battery tone');
        try {
            playLowBatteryToneFn();
        } catch (error) {
            logger.error('Failed to play low-battery tone', error);
        }
        return;
    }

    if (!shouldAlarm && batteryState.alarmActive) {
        batteryState.alarmActive = false;
    }
}

// Wire the manager into the host app and hydrate runtime state.
function initializeBatteryManager({
    config,
    io,
    turnHandler,
    roombaStatus,
    alertAdmins,
    playLowBatteryTone,
    accessControlState,
    triggerDockCommand,
    stopAiControlLoop,
}) {
    if (!io) throw new Error('batteryManager: io instance is required');
    if (!roombaStatus) throw new Error('batteryManager: roombaStatus reference is required');

    ioRef = io;
    turnHandlerRef = turnHandler || null;
    roombaStatusRef = roombaStatus;
    alertAdminsFn = alertAdmins || null;
    playLowBatteryToneFn = playLowBatteryTone || null;
    accessControlStateRef = accessControlState || null;
    triggerDockCommandFn = typeof triggerDockCommand === 'function' ? triggerDockCommand : null;
    stopAiControlLoopFn = typeof stopAiControlLoop === 'function' ? stopAiControlLoop : null;

    const batteryConfig = config?.battery || {};
    const autoChargeConfig = batteryConfig.autoCharge || {};

    thresholds = {
        alertCooldownMs: Number.isFinite(batteryConfig.alertCooldownMs) && batteryConfig.alertCooldownMs > 0
            ? batteryConfig.alertCooldownMs
            : DEFAULT_ALERT_COOLDOWN_MS,
        dockReminderIntervalMs: Number.isFinite(batteryConfig.dockReminderIntervalMs) && batteryConfig.dockReminderIntervalMs > 0
            ? batteryConfig.dockReminderIntervalMs
            : DEFAULT_DOCK_REMINDER_INTERVAL_MS,
        emptyVoltageMv: Number.isFinite(batteryConfig.emptyVoltageMv) && batteryConfig.emptyVoltageMv > 0
            ? batteryConfig.emptyVoltageMv
            : DEFAULT_EMPTY_VOLTAGE_MV,
        fullVoltageMv: Number.isFinite(batteryConfig.fullVoltageMv) && batteryConfig.fullVoltageMv > 0
            ? batteryConfig.fullVoltageMv
            : DEFAULT_FULL_VOLTAGE_MV,
        lowVoltageMv: Number.isFinite(batteryConfig.warningVoltageMv) && batteryConfig.warningVoltageMv > 0
            ? batteryConfig.warningVoltageMv
            : DEFAULT_LOW_THRESHOLD_MV,
        recoverVoltageMv: Number.isFinite(batteryConfig.recoverVoltageMv) && batteryConfig.recoverVoltageMv > 0
            ? batteryConfig.recoverVoltageMv
            : DEFAULT_RECOVER_THRESHOLD_MV,
        filterAlpha: clampNumber(
            Number.isFinite(batteryConfig.filterAlpha) ? batteryConfig.filterAlpha : DEFAULT_FILTER_ALPHA,
            0.01,
            1
        ),
        lowDebounceMs: Number.isFinite(batteryConfig.lowDebounceMs) && batteryConfig.lowDebounceMs >= 0
            ? batteryConfig.lowDebounceMs
            : DEFAULT_LOW_DEBOUNCE_MS,
        clearDebounceMs: Number.isFinite(batteryConfig.clearDebounceMs) && batteryConfig.clearDebounceMs >= 0
            ? batteryConfig.clearDebounceMs
            : DEFAULT_CLEAR_DEBOUNCE_MS,
        clearMarginMv: Number.isFinite(batteryConfig.clearMarginMv) && batteryConfig.clearMarginMv >= 0
            ? batteryConfig.clearMarginMv
            : DEFAULT_CLEAR_MARGIN_MV,
        fullChargeRatio: clampNumber(
            Number.isFinite(batteryConfig.fullChargeRatio) ? batteryConfig.fullChargeRatio : DEFAULT_FULL_CHARGE_RATIO,
            0.5,
            1
        ),
    };

    autoChargeState = {
        enabled: autoChargeConfig.enabled !== false,
        dockIdleStartAt: null,
        timeoutMs: Number.isFinite(autoChargeConfig.timeoutMs) && autoChargeConfig.timeoutMs >= 0
            ? autoChargeConfig.timeoutMs
            : DEFAULT_AUTOCHARGE_TIMEOUT_MS,
    };

    batteryVoltageTrend = {
        filteredVoltage: null,
        lowSince: 0,
        highSince: 0,
        displayWarning: false,
        lastSampleAt: 0,
    };

    batteryState = {
        needsCharge: false,
        lastAlertAt: 0,
        lastDockReminderAt: 0,
        lastResumeNoticeAt: 0,
        chargingPauseNotified: false,
        voltageStats: null,
        alarmActive: false,
    };

    if (batteryAlarmTimer) {
        clearInterval(batteryAlarmTimer);
    }
    batteryAlarmTimer = setInterval(batteryAlarmTick, BATTERY_ALARM_INTERVAL_MS);
}

// Entry point from the serial packet stream; run on every sensor update.
function handleSensorUpdate({
    chargeStatus,
    batteryCharge,
    batteryCapacity,
    batteryVoltage,
    chargingSources,
}) {
    if (!thresholds) {
        throw new Error('batteryManager: initializeBatteryManager must be called before handleSensorUpdate');
    }

    const isDocked = chargingSources === 2;
    const isCharging = CHARGING_STATUS_CODES.has(chargeStatus);

    roombaStatusRef.docked = isDocked;
    roombaStatusRef.chargeStatus = isCharging;
    roombaStatusRef.batteryCharge = batteryCharge;
    roombaStatusRef.batteryCapacity = batteryCapacity;
    roombaStatusRef.batteryVoltage = batteryVoltage;

    const voltageStats = updateBatteryVoltageTrend(batteryVoltage);
    batteryState.voltageStats = voltageStats;
    roombaStatusRef.batteryFilteredVoltage = voltageStats.filteredVoltage;

    const chargeFraction = Number.isFinite(batteryCapacity) && batteryCapacity > 0
        ? clampNumber(batteryCharge / batteryCapacity, 0, 1)
        : null;

    const filteredVoltage = Number.isFinite(voltageStats.filteredVoltage)
        ? voltageStats.filteredVoltage
        : batteryVoltage;
    const batteryPercentage = calculateBatteryPercentage(
        batteryCharge,
        batteryCapacity,
        filteredVoltage
    );
    roombaStatusRef.batteryPercentage = batteryPercentage;

    const now = Date.now();

    evaluateBatteryState({
        now,
        percent: batteryPercentage,
        filteredVoltage,
        isCharging,
        isDocked,
        chargeFraction,
    });

    handleAutoCharge(now, { isDocked, isCharging });

    const chargeAlert = buildChargeAlertPayload({
        chargeStatus,
        batteryCharge,
        batteryCapacity,
        batteryVoltage,
        voltageStats,
        chargeFraction,
    });

    return {
        batteryPercentage,
        filteredVoltage: voltageStats.filteredVoltage,
        chargeAlert,
        chargeFraction,
    };
}

module.exports = {
    initializeBatteryManager,
    handleSensorUpdate,
};
