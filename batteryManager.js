const DEFAULT_ALERT_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_DOCK_REMINDER_INTERVAL_MS = 2 * 60_000;
const DEFAULT_FILTER_ALPHA = 0.25;
const DEFAULT_EMPTY_VOLTAGE_MV = 13_200;
const DEFAULT_FULL_VOLTAGE_MV = 16_800;
const DEFAULT_LOW_THRESHOLD_MV = 14_400;
const DEFAULT_RECOVER_THRESHOLD_MV = 15_600;
const DEFAULT_LOW_DEBOUNCE_MS = 1_500;
const DEFAULT_CLEAR_DEBOUNCE_MS = 2_500;
const DEFAULT_CLEAR_MARGIN_MV = 200;
const DEFAULT_FULL_CHARGE_RATIO = 0.98;
const DEFAULT_AUTOCHARGE_TIMEOUT_MS = 10_000;
const BATTERY_ALARM_INTERVAL_MS = 5_000;
const CHARGING_STATUS_CODES = new Set([1, 2, 3, 4]);

let ioRef = null;
let turnHandlerRef = null;
let roombaStatusRef = null;
let alertAdminsFn = null;
let playLowBatteryToneFn = null;
let accessControlStateRef = null;
let triggerDockCommandFn = null;
let stopAiControlLoopFn = null;

let thresholds = null;
let batteryVoltageTrend = null;
let batteryState = null;
let batteryAlarmTimer = null;
let autoChargeState = null;

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function calculateBatteryPercentage(charge, capacity, voltage) {
    const emptyVoltage = thresholds?.emptyVoltageMv ?? DEFAULT_EMPTY_VOLTAGE_MV;
    const fullVoltage = thresholds?.fullVoltageMv ?? DEFAULT_FULL_VOLTAGE_MV;
    const voltageValue = Number.isFinite(voltage) ? voltage : emptyVoltage;
    const clampedVoltage = clampNumber(voltageValue, emptyVoltage, fullVoltage);
    const range = Math.max(1, fullVoltage - emptyVoltage);
    const fraction = (clampedVoltage - emptyVoltage) / range;
    return Math.round(clampNumber(fraction, 0, 1) * 100);
}

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

function notifyBatteryLow(percent, voltage) {
    const summary = formatBatterySummary(percent, voltage);
    const message = `Battery low (${summary}). Please dock the rover to charge.`;
    console.log('[BatteryMgr] Low battery detected:', summary);
    ioRef.emit('alert', message);

    if (typeof alertAdminsFn === 'function') {
        alertAdminsFn(`[Roomba Rover] ${message}`).catch((error) => {
            console.error('Failed to alert Discord admins about low battery:', error);
        });
    }
}

function notifyChargingPause(percent, voltage, turnsModeActive) {
    const summary = formatBatterySummary(percent, voltage);
    const message = turnsModeActive
        ? `Battery charging (${summary}). Turns are paused until charging completes.`
        : `Battery charging (${summary}). Please keep the rover docked until it finishes.`;
    console.log('[BatteryMgr] Charging detected:', summary, '| turns mode active:', turnsModeActive);
    ioRef.emit('alert', message);
    ioRef.emit('message', message);
}

function notifyDockReminder(percent, voltage) {
    const summary = formatBatterySummary(percent, voltage);
    const message = `Battery still low (${summary}). Please dock the rover as soon as possible.`;
    console.log('[BatteryMgr] Dock reminder triggered:', summary);
    ioRef.emit('alert', message);
}

function notifyBatteryRecovered(percent, voltage, turnsModeActive) {
    const summary = formatBatterySummary(percent, voltage);
    const message = turnsModeActive
        ? `Battery recovered (${summary}). Turns have resumed.`
        : `Battery recovered (${summary}).`;
    console.log('[BatteryMgr] Battery recovered:', summary, '| turns mode active:', turnsModeActive);
    ioRef.emit('alert', message);
    ioRef.emit('message', message);
}

function sendAutoChargeMessage(text) {
    if (!ioRef || !text) return;
    ioRef.emit('message', text);
}

function handleAutoCharge(now, { isDocked, isCharging }) {
    if (!autoChargeState) return;

    if (isDocked && typeof stopAiControlLoopFn === 'function') {
        try {
            stopAiControlLoopFn();
        } catch (error) {
            console.error('[BatteryMgr] Failed to stop AI control loop during autocharge:', error);
        }
    }

    if (!autoChargeState.enabled || typeof triggerDockCommandFn !== 'function') {
        autoChargeState.dockIdleStartAt = null;
        return;
    }

    if (isDocked && !isCharging) {
        if (!autoChargeState.dockIdleStartAt) {
            autoChargeState.dockIdleStartAt = now;
            console.log('[BatteryMgr] Autocharge timer started (docked, not charging).');
            sendAutoChargeMessage('Autocharging timer started');
        } else if (now - autoChargeState.dockIdleStartAt >= autoChargeState.timeoutMs) {
            console.log('[BatteryMgr] Autocharge timeout reached; issuing dock command.');
            try {
                triggerDockCommandFn();
            } catch (error) {
                console.error('[BatteryMgr] Failed to send autocharge dock command:', error);
            }
            sendAutoChargeMessage('Autocharging initiated');
            autoChargeState.dockIdleStartAt = null;
        }
        return;
    }

    if (autoChargeState.dockIdleStartAt) {
        autoChargeState.dockIdleStartAt = null;
        console.log('[BatteryMgr] Autocharge timer reset (conditions cleared).');
        sendAutoChargeMessage('Resetting autocharge timer');
    }
}

function isTurnsModeActive() {
    return accessControlStateRef?.mode === 'turns';
}

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
        console.log('[BatteryMgr] Entering low battery state. percent:', percent, 'voltage:', filteredVoltage);
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
            console.log('[BatteryMgr] Low battery cooldown elapsed, re-alerting. percent:', percent, 'voltage:', filteredVoltage);
            notifyBatteryLow(percent, filteredVoltage);
        }
    }

    const recovered = batteryState.needsCharge && reachedFullCharge;

    if (recovered) {
        batteryState.needsCharge = false;
        batteryState.chargingPauseNotified = false;
        batteryState.lastResumeNoticeAt = now;
        console.log('[BatteryMgr] Battery recovered above thresholds. percent:', percent, 'voltage:', filteredVoltage);
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
        return;
    }

    if (isDocked && isCharging) {
        ensureTurnPause(turnsModeActive);
        if (!batteryState.chargingPauseNotified) {
            console.log('[BatteryMgr] Announcing charging pause. percent:', percent, 'voltage:', filteredVoltage);
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

function batteryAlarmTick() {
    if (!playLowBatteryToneFn) return;
    const shouldAlarm = batteryState.needsCharge && !roombaStatusRef?.docked;

    if (shouldAlarm && !batteryState.alarmActive) {
        batteryState.alarmActive = true;
        console.log('[BatteryMgr] Playing low-battery tone.');
        try {
            playLowBatteryToneFn();
        } catch (error) {
            console.error('[BatteryMgr] Failed to play low-battery tone:', error);
        }
        return;
    }

    if (!shouldAlarm && batteryState.alarmActive) {
        batteryState.alarmActive = false;
    }
}

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
