import { socket } from './socketGlobal.js';
import { showToast } from './toaster.js';

const CONFIRM_PHRASE = 'confirm';

const elements = {
    triggers: Array.from(document.querySelectorAll('[data-emergency-trigger]')),
    modal: document.getElementById('emergency-modal'),
    stepIntro: document.getElementById('emergency-modal-step1'),
    stepPhrase: document.getElementById('emergency-modal-step2'),
    introConfirm: document.getElementById('emergency-step1-confirm'),
    introCancel: document.getElementById('emergency-step1-cancel'),
    phraseConfirm: document.getElementById('emergency-step2-confirm'),
    phraseCancel: document.getElementById('emergency-step2-cancel'),
    confirmInput: document.getElementById('emergency-confirm-input'),
    globalOverlay: document.getElementById('emergency-global-overlay'),
    globalTitle: document.getElementById('emergency-global-title'),
    globalSubtitle: document.getElementById('emergency-global-subtitle'),
    globalTimer: document.getElementById('emergency-global-timer'),
    globalDetails: document.getElementById('emergency-global-details'),
    globalCancel: document.getElementById('emergency-global-cancel'),
};

let isAdmin = false;
let submissionPending = false;
let overlayStep = null;
let currentStatus = {
    state: 'idle',
    initiatedByYou: false,
    canCancel: false,
    outcome: null,
};

function toggleHidden(element, shouldHide) {
    if (!element) return;
    element.classList.toggle('hidden', shouldHide);
}

function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function showOverlay(step) {
    if (!elements.modal) return;
    overlayStep = step;
    elements.modal.classList.remove('hidden');
    elements.modal.setAttribute('data-step', step);

    if (elements.stepIntro) {
        toggleHidden(elements.stepIntro, step !== 'intro');
    }
    if (elements.stepPhrase) {
        toggleHidden(elements.stepPhrase, step !== 'phrase');
    }

    if (step === 'phrase' && elements.confirmInput) {
        elements.confirmInput.value = '';
        updateConfirmButtonState();
        elements.confirmInput.focus();
    } else if (step !== 'phrase') {
        updateConfirmButtonState();
    }
}

function hideOverlay() {
    if (!elements.modal) return;
    overlayStep = null;
    elements.modal.classList.add('hidden');
    elements.modal.removeAttribute('data-step');
    submissionPending = false;
    if (elements.confirmInput) {
        elements.confirmInput.value = '';
    }
    updateConfirmButtonState();
    updateTriggerAvailability();
}

function rebuildDetails(container, entries) {
    if (!container) return;
    container.replaceChildren();
    if (!entries.length) {
        container.classList.add('hidden');
        return;
    }
    entries.forEach((text) => {
        const line = document.createElement('p');
        line.textContent = text;
        container.appendChild(line);
    });
    container.classList.remove('hidden');
}

function buildTelemetryDetails(telemetry) {
    if (!telemetry || typeof telemetry !== 'object') {
        return [];
    }

    const details = [];
    const { batteryCharge, batteryCapacity, batteryVoltage, oiMode } = telemetry;

    if (Number.isFinite(batteryCharge) && Number.isFinite(batteryCapacity)) {
        details.push(`Battery ${batteryCharge}/${batteryCapacity}`);
    }
    if (Number.isFinite(batteryVoltage)) {
        details.push(`Voltage ${batteryVoltage.toFixed(2)} V`);
    }
    if (oiMode) {
        details.push(`OI ${oiMode}`);
    }

    return details;
}

function renderOutcome(status) {
    const outcome = status.outcome || null;

    if (status.state === 'executed' && outcome) {
        const executedTime = new Date(outcome.timestamp).toLocaleTimeString();
        const details = buildTelemetryDetails(outcome.telemetry);
        const detailText = details.length ? ` ${details.join(' | ')}` : '';
        showToast(`Owner alert sent at ${executedTime}.${detailText}`, 'error', false);
        return;
    }

    if (status.state === 'canceled' && outcome) {
        const canceledTime = new Date(outcome.timestamp).toLocaleTimeString();
        const canceller = outcome.actedBy?.nickname || 'Unknown';
        const details = buildTelemetryDetails(outcome.telemetry);
        const detailText = details.length ? ` ${details.join(' | ')}` : '';
        showToast(`Owner alert canceled by ${canceller} at ${canceledTime}.${detailText}`, 'info');
        return;
    }
}

function updateGlobalOverlayContent(status) {
    if (!elements.globalOverlay) return;

    const state = status.state;
    if (!state || state === 'idle') {
        toggleHidden(elements.globalOverlay, true);
        return;
    }

    toggleHidden(elements.globalOverlay, false);

    const initiatorName = status.initiator?.nickname || 'Unknown';
    const youSuffix = status.initiatedByYou ? ' (you)' : '';
    const details = [];

    let title = 'Owner Alert';
    let subtitle = '';
    let timerText = '';
    let showTimer = false;
    let showCancel = false;
    let cancelEnabled = false;

    if (state === 'countdown') {
        title = 'Owner Alert Countdown';
        subtitle = `Owner alert fires when the timer ends. Started by ${initiatorName}${youSuffix}.`;
        timerText = formatCountdown(status.remainingMs || 0);
        showTimer = true;
        const eta = status.remainingMs ? new Date(Date.now() + status.remainingMs).toLocaleTimeString() : null;
        if (eta) {
            details.push(`Estimated alert time: ${eta}`);
        }
        showCancel = true;
        cancelEnabled = Boolean(status.canCancel) || isAdmin;
    } else if (state === 'executed') {
        title = 'Owner Alert Sent';
        const firedAt = status.outcome?.timestamp ? new Date(status.outcome.timestamp).toLocaleTimeString() : null;
        subtitle = firedAt ? `Owner notified at ${firedAt}.` : 'Owner notification delivered.';
        showTimer = false;
        details.push(...buildTelemetryDetails(status.outcome?.telemetry));
    } else if (state === 'canceled') {
        title = 'Owner Alert Canceled';
        const canceller = status.outcome?.actedBy?.nickname || 'Unknown';
        const canceledAt = status.outcome?.timestamp ? new Date(status.outcome.timestamp).toLocaleTimeString() : null;
        subtitle = canceledAt ? `Canceled by ${canceller} at ${canceledAt}.` : `Canceled by ${canceller}.`;
        showTimer = false;
        details.push(...buildTelemetryDetails(status.outcome?.telemetry));
    }

    if (elements.globalTitle) {
        elements.globalTitle.textContent = title;
    }
    if (elements.globalSubtitle) {
        elements.globalSubtitle.textContent = subtitle;
    }
    if (elements.globalTimer) {
        elements.globalTimer.textContent = showTimer ? timerText : '';
        elements.globalTimer.classList.toggle('hidden', !showTimer);
    }
    rebuildDetails(elements.globalDetails, details);

    if (elements.globalCancel) {
        if (showCancel) {
            toggleHidden(elements.globalCancel, false);
            elements.globalCancel.disabled = !cancelEnabled;
            elements.globalCancel.classList.toggle('opacity-50', !cancelEnabled);
            elements.globalCancel.classList.toggle('pointer-events-none', !cancelEnabled);
        } else {
            toggleHidden(elements.globalCancel, true);
        }
    }
}

function updateTriggerAvailability() {
    const disabled = submissionPending || currentStatus.state === 'countdown';
    elements.triggers.forEach((button) => {
        if (!button) return;
        button.disabled = disabled;
        button.classList.toggle('opacity-50', disabled);
        button.classList.toggle('pointer-events-none', disabled);
    });
}

function updateConfirmButtonState() {
    if (!elements.phraseConfirm) return;
    const value = elements.confirmInput ? elements.confirmInput.value.trim().toLowerCase() : '';
    const valid = value === CONFIRM_PHRASE && !submissionPending;
    elements.phraseConfirm.disabled = !valid;
    elements.phraseConfirm.classList.toggle('opacity-50', elements.phraseConfirm.disabled);
    elements.phraseConfirm.classList.toggle('pointer-events-none', elements.phraseConfirm.disabled);
}

function handleStatusUpdate(status) {
    const previousStatus = currentStatus;
    currentStatus = status;
    submissionPending = false;
    updateTriggerAvailability();
    updateConfirmButtonState();

    if (status.state === 'countdown' && overlayStep) {
        hideOverlay();
    }

    updateGlobalOverlayContent(status);

    if (status.state !== 'countdown' && previousStatus?.state !== status.state) {
        renderOutcome(status);
    }
}

function emitInitiate() {
    if (!elements.confirmInput) return;
    const phrase = elements.confirmInput.value.trim().toLowerCase();
    if (phrase !== CONFIRM_PHRASE || submissionPending) return;
    submissionPending = true;
    updateConfirmButtonState();
    updateTriggerAvailability();
    socket.emit('emergency:initiate', { phrase });
}

function handleCancelRequest() {
    if (!currentStatus.canCancel && !isAdmin) return;
    socket.emit('emergency:cancel');
}

elements.triggers.forEach((button) => {
    if (!button) return;
    button.addEventListener('click', () => {
        if (currentStatus.state === 'countdown') return;
        showOverlay('intro');
    });
});

if (elements.introConfirm) {
    elements.introConfirm.addEventListener('click', () => showOverlay('phrase'));
}

if (elements.introCancel) {
    elements.introCancel.addEventListener('click', () => hideOverlay());
}

if (elements.phraseCancel) {
    elements.phraseCancel.addEventListener('click', () => hideOverlay());
}

if (elements.phraseConfirm) {
    elements.phraseConfirm.addEventListener('click', emitInitiate);
}

if (elements.globalCancel) {
    elements.globalCancel.addEventListener('click', handleCancelRequest);
}

if (elements.confirmInput) {
    elements.confirmInput.addEventListener('input', updateConfirmButtonState);
    elements.confirmInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            emitInitiate();
        }
    });
}

socket.on('emergency:status', (status) => {
    handleStatusUpdate(status || { state: 'idle', canCancel: false });
});

socket.on('emergency:error', (message) => {
    submissionPending = false;
    updateConfirmButtonState();
    updateTriggerAvailability();
    showToast(message || 'Owner alert request failed.', 'error', false);
});

socket.on('admin-login', () => {
    isAdmin = true;
    updateGlobalOverlayContent(currentStatus);
});

socket.on('connect', () => {
    isAdmin = false;
    submissionPending = false;
    updateTriggerAvailability();
    updateConfirmButtonState();
    updateGlobalOverlayContent(currentStatus);
});

socket.on('disconnect', () => {
    isAdmin = false;
    hideOverlay();
    toggleHidden(elements.globalOverlay, true);
});
