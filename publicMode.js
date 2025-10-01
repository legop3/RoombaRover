const EventEmitter = require('events');
const config = require('./config.json');

const AccessModes = Object.freeze({
    PUBLIC: 'public',
    ADMIN_ONLY: 'admin-only',
    TURNS: 'turns'
});

const publicModeEmitter = new EventEmitter();

function normalizeMode(mode) {
    if (!mode || typeof mode !== 'string') return null;
    const lower = mode.toLowerCase();
    return Object.values(AccessModes).includes(lower) ? lower : null;
}

const defaultModeFromConfig = normalizeMode(config.accessControl?.defaultMode);
const fallbackMode = config.accessControl?.enabled ? AccessModes.ADMIN_ONLY : AccessModes.PUBLIC;
let controlMode = defaultModeFromConfig || fallbackMode;

function emitModeChange(previous) {
    const payload = { mode: controlMode, previous };
    publicModeEmitter.emit('controlModeChanged', payload);
    publicModeEmitter.emit('publicModeChanged', {
        enabled: controlMode === AccessModes.PUBLIC,
        mode: controlMode,
        previous
    });

    if (controlMode === AccessModes.PUBLIC && previous !== AccessModes.PUBLIC) {
        publicModeEmitter.emit('publicModeEnabled');
    }

    if (previous === AccessModes.PUBLIC && controlMode !== AccessModes.PUBLIC) {
        publicModeEmitter.emit('publicModeDisabled');
    }
}

function setControlMode(mode) {
    const normalized = normalizeMode(mode);
    if (!normalized) {
        console.warn(`Attempted to set invalid control mode: ${mode}`);
        return controlMode;
    }

    if (normalized === controlMode) {
        return controlMode;
    }

    const previous = controlMode;
    controlMode = normalized;
    console.log(`🔁 Control mode changed from ${previous} to ${controlMode}`);
    emitModeChange(previous);
    return controlMode;
}

function getControlMode() {
    return controlMode;
}

function enablePublicMode() {
    return setControlMode(AccessModes.PUBLIC);
}

function disablePublicMode() {
    return setControlMode(AccessModes.ADMIN_ONLY);
}

function isPublicMode() {
    return controlMode === AccessModes.PUBLIC;
}

function isTurnsMode() {
    return controlMode === AccessModes.TURNS;
}

module.exports = {
    AccessModes,
    getControlMode,
    setControlMode,
    enablePublicMode,
    disablePublicMode,
    isPublicMode,
    isTurnsMode,
    publicModeEvent: publicModeEmitter,
    controlModeEvent: publicModeEmitter
};