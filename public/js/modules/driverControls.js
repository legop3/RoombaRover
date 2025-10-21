import { socket } from './socketGlobal.js';
import { numberOfLights } from './homeAssistantLights.js';
import {
    getActionsForKey,
    isCaptureInProgress,
    normalizeEventKey,
    subscribe,
} from './keyBindings.js';

console.log('driverControls module loaded');

// mode controls for layman
function easyStart() {
    socket.emit('easyStart');
    for (let i = 0; i < numberOfLights; i++) {
        socket.emit('light_switch', { index: i, state: true });
    }
}
window.easyStart = easyStart;

function easyDock() {
    socket.emit('easyDock');
}
window.easyDock = easyDock;

const DRIVE_ACTIONS = new Set([
    'driveForward',
    'driveBackward',
    'driveLeft',
    'driveRight',
    'precisionMode',
    'turboMode',
]);

const CLEANING_ACTIONS = new Set([
    'sideBrushForward',
    'sideBrushReverse',
    'vacuumHigh',
    'vacuumLow',
    'mainBrushForward',
    'mainBrushReverse',
    'allCleaners',
]);

const STATEFUL_ACTIONS = new Set([...DRIVE_ACTIONS, ...CLEANING_ACTIONS]);
const CHAT_ACTION = 'chatToggle';

const pressedKeys = new Set();
const actionCounts = new Map();

let lastDriveSpeeds = { leftSpeed: 0, rightSpeed: 0 };
let lastSideBrushSpeed = 0;
let lastVacuumSpeed = 0;
let lastMainBrushSpeed = 0;

subscribe(handleBindingsUpdated);

function handleBindingsUpdated() {
    if (pressedKeys.size === 0 && actionCounts.size === 0) {
        return;
    }
    pressedKeys.clear();
    actionCounts.clear();
    lastDriveSpeeds = { leftSpeed: 0, rightSpeed: 0 };
    lastSideBrushSpeed = 0;
    lastVacuumSpeed = 0;
    lastMainBrushSpeed = 0;
    refreshDriving(true);
    refreshAuxiliaryMotors(true);
}

function handleKeyEvent(event, isKeyDown) {
    if (isCaptureInProgress()) return;

    const keyId = normalizeEventKey(event);
    if (!keyId) return;

    const actions = getActionsForKey(keyId);
    if (!actions.length) return;

    const statefulActions = actions.filter((actionId) => STATEFUL_ACTIONS.has(actionId));
    const hasChatAction = actions.includes(CHAT_ACTION);

    if (isKeyDown) {
        if (pressedKeys.has(keyId)) return;
        pressedKeys.add(keyId);

        let driveChanged = false;
        let cleaningChanged = false;

        statefulActions.forEach((actionId) => {
            const changed = incrementAction(actionId);
            if (DRIVE_ACTIONS.has(actionId)) driveChanged = driveChanged || changed;
            if (CLEANING_ACTIONS.has(actionId)) cleaningChanged = cleaningChanged || changed;
        });

        if (driveChanged) {
            refreshDriving();
        }
        if (cleaningChanged) {
            refreshAuxiliaryMotors();
        }

        if (hasChatAction) {
            handleChatToggle();
        }
    } else {
        if (!pressedKeys.has(keyId)) return;
        pressedKeys.delete(keyId);

        let driveChanged = false;
        let cleaningChanged = false;

        statefulActions.forEach((actionId) => {
            const changed = decrementAction(actionId);
            if (DRIVE_ACTIONS.has(actionId)) driveChanged = driveChanged || changed;
            if (CLEANING_ACTIONS.has(actionId)) cleaningChanged = cleaningChanged || changed;
        });

        if (driveChanged) {
            refreshDriving();
        }
        if (cleaningChanged) {
            refreshAuxiliaryMotors();
        }
    }
}

document.addEventListener('keydown', (event) => handleKeyEvent(event, true));
document.addEventListener('keyup', (event) => handleKeyEvent(event, false));

function incrementAction(actionId) {
    const current = actionCounts.get(actionId) || 0;
    const next = current + 1;
    actionCounts.set(actionId, next);
    return current === 0;
}

function decrementAction(actionId) {
    const current = actionCounts.get(actionId) || 0;
    if (current <= 1) {
        if (actionCounts.has(actionId)) {
            actionCounts.delete(actionId);
            return true;
        }
        return false;
    }
    actionCounts.set(actionId, current - 1);
    return false;
}

function isActionActive(actionId) {
    return actionCounts.has(actionId);
}

function refreshDriving(force = false) {
    const speeds = keySpeedCalculator({
        forward: isActionActive('driveForward'),
        backward: isActionActive('driveBackward'),
        left: isActionActive('driveLeft'),
        right: isActionActive('driveRight'),
        turbo: isActionActive('turboMode'),
        precision: isActionActive('precisionMode'),
    });

    if (
        !force &&
        speeds.leftSpeed === lastDriveSpeeds.leftSpeed &&
        speeds.rightSpeed === lastDriveSpeeds.rightSpeed
    ) {
        return;
    }

    lastDriveSpeeds = { leftSpeed: speeds.leftSpeed, rightSpeed: speeds.rightSpeed };
    socket.emit('Speedchange', { ...speeds, timestamp: Date.now() });
}

function refreshAuxiliaryMotors(force = false) {
    const allActive = isActionActive('allCleaners');

    let sideBrushSpeed = 0;
    if (allActive) {
        sideBrushSpeed = 127;
    } else {
        if (isActionActive('sideBrushForward')) sideBrushSpeed = 127;
        if (isActionActive('sideBrushReverse')) sideBrushSpeed = -50;
    }

    let vacuumSpeed = 0;
    if (allActive || isActionActive('vacuumHigh')) {
        vacuumSpeed = 127;
    } else if (isActionActive('vacuumLow')) {
        vacuumSpeed = 20;
    }

    let mainBrushSpeed = 0;
    if (allActive) {
        mainBrushSpeed = 127;
    } else {
        if (isActionActive('mainBrushForward')) mainBrushSpeed = 127;
        if (isActionActive('mainBrushReverse')) mainBrushSpeed = -50;
    }

    if (force || sideBrushSpeed !== lastSideBrushSpeed) {
        lastSideBrushSpeed = sideBrushSpeed;
        socket.emit('sideBrush', { speed: sideBrushSpeed });
    }
    if (force || vacuumSpeed !== lastVacuumSpeed) {
        lastVacuumSpeed = vacuumSpeed;
        socket.emit('vacuumMotor', { speed: vacuumSpeed });
    }
    if (force || mainBrushSpeed !== lastMainBrushSpeed) {
        lastMainBrushSpeed = mainBrushSpeed;
        socket.emit('brushMotor', { speed: mainBrushSpeed });
    }
}

function keySpeedCalculator(state) {
    const baseSpeed = 100;
    const fastMultiplier = 2.5;
    const slowMultiplier = 0.5;

    let left = 0;
    let right = 0;
    let multiplier = 1;

    if (state.turbo) {
        multiplier = fastMultiplier;
    } else if (state.precision) {
        multiplier = slowMultiplier;
    }

    if (state.forward) {
        left += baseSpeed;
        right += baseSpeed;
    }
    if (state.backward) {
        left -= baseSpeed;
        right -= baseSpeed;
    }
    if (state.left) {
        left -= baseSpeed;
        right += baseSpeed;
    }
    if (state.right) {
        left += baseSpeed;
        right -= baseSpeed;
    }

    return {
        leftSpeed: left * multiplier,
        rightSpeed: right * multiplier,
    };
}

function handleChatToggle() {
    const sendButton = document.getElementById('sendMessageButton');
    const messageInput = document.getElementById('messageInput');
    if (!sendButton || !messageInput) return;

    if (document.activeElement === messageInput) {
        sendButton.click();
        if (!messageInput.value) {
            messageInput.blur();
        }
    } else {
        messageInput.focus();
    }
}
