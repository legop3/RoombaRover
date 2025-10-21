import { socket } from '../modules/socketGlobal.js';
import { featureEnabled } from '../modules/features.js';
import { showToast } from '../modules/toaster.js';
import { bindMediaElement } from '../modules/volumeControl.js';

const turnAlertAudio = new Audio('/turn_alert.mp3');
turnAlertAudio.preload = 'auto';
bindMediaElement(turnAlertAudio);

let lastAlertedTurnKey = null;
let selfId = null;

const forceSpectateMode = featureEnabled('forceSpectateMode', false);

const cardElements = Array.from(document.querySelectorAll('[data-turns-card]'));
const statusElements = Array.from(document.querySelectorAll('[data-turns-status]'));
const countdownElements = Array.from(document.querySelectorAll('[data-turns-countdown]'));
const listElements = Array.from(document.querySelectorAll('[data-turns-list]'));
const spectateCheckboxes = Array.from(document.querySelectorAll('[data-spectate-toggle]'));

function syncSpectateCheckboxes(checked) {
  spectateCheckboxes.forEach((checkbox) => {
    if (checkbox.checked !== checked) {
      checkbox.checked = checked;
    }
  });
}

function handleSpectateChange(event) {
  const isChecked = Boolean(event.target?.checked);
  syncSpectateCheckboxes(isChecked);
  socket.emit('set-spectate-mode', isChecked);
}

spectateCheckboxes.forEach((checkbox) => {
  checkbox.addEventListener('change', handleSpectateChange);
});

function setTextAll(elements, text) {
  elements.forEach((el) => {
    el.textContent = text;
  });
}

function addClasses(elements, classes) {
  elements.forEach((el) => {
    el.classList.add(...classes);
  });
}

function removeClasses(elements, classes) {
  elements.forEach((el) => {
    el.classList.remove(...classes);
  });
}

function setHidden(elements, hidden) {
  elements.forEach((el) => {
    el.classList.toggle('hidden', hidden);
  });
}

function resetTurnAppearance() {
  removeClasses(cardElements, ['bg-green-600', 'bg-yellow-600', 'shadow-lg']);
  addClasses(cardElements, ['bg-gray-700']);

  removeClasses(statusElements, ['bg-green-500', 'bg-yellow-500', 'text-black', 'font-semibold']);
  addClasses(statusElements, ['bg-gray-700']);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '0s';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

socket.on('connect', () => {
  selfId = socket.id;
  if (forceSpectateMode) {
    syncSpectateCheckboxes(true);
    socket.emit('set-spectate-mode', true);
  }
});

socket.on('disconnect', () => {
  selfId = null;
});

socket.on('turns:update', (data = {}) => {
  if (!cardElements.length && !statusElements.length) {
    return;
  }

  resetTurnAppearance();

  if (!data.isTurnModeActive) {
    lastAlertedTurnKey = null;
    setHidden(cardElements, true);
    setTextAll(statusElements, 'Turns mode not active.');
    setTextAll(countdownElements, '');
    listElements.forEach((el) => {
      el.replaceChildren();
    });
    return;
  }

  setHidden(cardElements, false);

  const queue = Array.isArray(data.queue) ? data.queue : [];
  const turnDuration = data.turnDurationMs || 0;
  const serverNow = data.serverTimestamp || Date.now();
  const remainingCurrent = data.turnExpiresAt ? Math.max(0, data.turnExpiresAt - serverNow) : 0;
  const idleSkipExpiresAt =
    typeof data.idleSkipExpiresAt === 'number' && Number.isFinite(data.idleSkipExpiresAt)
      ? data.idleSkipExpiresAt
      : null;
  const idleSkipRemaining = idleSkipExpiresAt !== null ? Math.max(0, idleSkipExpiresAt - serverNow) : null;
  const idleSkipActive = Boolean(idleSkipExpiresAt !== null && idleSkipExpiresAt > serverNow);
  const chargingPauseActive = Boolean(data.chargingPause);
  const chargingPauseReason = data.chargingPauseReason || '';
  const turnIdentifier =
    typeof data.turnExpiresAt === 'number' && Number.isFinite(data.turnExpiresAt)
      ? `${data.turnExpiresAt}:${data.currentDriverId || ''}`
      : data.currentDriverId
        ? `id:${data.currentDriverId}`
        : null;

  listElements.forEach((list) => {
    list.replaceChildren();
    if (queue.length === 0) {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'text-sm bg-gray-700 rounded-xl p-2 text-center';
      emptyRow.textContent = 'No drivers are waiting right now.';
      list.appendChild(emptyRow);
      return;
    }

    queue.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'p-2 rounded-xl bg-gray-700 flex justify-between text-sm';

      const baseName =
        entry && typeof entry.nickname === 'string' && entry.nickname.trim()
          ? entry.nickname.trim()
          : entry?.id && entry.id.length > 6
            ? `User ${entry.id.slice(-6)}`
            : entry?.id || 'User';
      const isSelf = selfId && entry?.id === selfId;
      const label = isSelf ? `You (${baseName})` : baseName;

      const positionSpan = document.createElement('span');
      positionSpan.textContent = `${idx + 1}. ${label}`;

      const statusSpan = document.createElement('span');
      if (chargingPauseActive && idx === 0) {
        statusSpan.textContent = 'Paused';
      } else if (entry?.isCurrent && idleSkipActive) {
        statusSpan.textContent = 'Idle (skipping soon)';
      } else {
        statusSpan.textContent = entry?.isCurrent ? 'Driving' : '';
      }

      row.appendChild(positionSpan);
      row.appendChild(statusSpan);
      list.appendChild(row);
    });
  });

  let yourStatus = '';
  let countdown = '';
  let position = -1;

  if (!selfId) {
    yourStatus = queue.length ? 'Connect to claim a spot in the queue.' : 'Turns mode active. Waiting for drivers to join.';
  } else if (queue.length === 0) {
    yourStatus = 'Turns mode active. Waiting for drivers to join.';
  } else {
    position = queue.findIndex((entry) => entry?.id === selfId);
    if (position === -1) {
      yourStatus = queue.length ? 'Admins can drive without waiting.' : 'Turns mode active. Waiting for drivers to join.';
    } else if (position === 0) {
      yourStatus = 'It is your turn to drive!';
      if (!chargingPauseActive && data.mode === 'turns' && turnIdentifier && lastAlertedTurnKey !== turnIdentifier) {
        lastAlertedTurnKey = turnIdentifier;
        showToast('It is your turn!!! Start driving!!');
        try {
          turnAlertAudio.currentTime = 0;
          const playPromise = turnAlertAudio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => console.debug('Unable to play turn alert sound:', err));
          }
        } catch (err) {
          console.debug('Unable to play turn alert sound:', err);
        }
      }
      if (!chargingPauseActive && idleSkipActive) {
        const idleCountdownSeconds = Math.max(1, Math.ceil((idleSkipRemaining || 0) / 1000));
        const idleCountdownText = `${idleCountdownSeconds}s`;
        const turnCountdownText = remainingCurrent ? ` Total turn time left: ${formatDuration(remainingCurrent)}.` : '';
        yourStatus = 'It is your turn—move now to keep it!';
        countdown = `Move the rover or your turn skips in ${idleCountdownText}.${turnCountdownText}`;
        removeClasses(cardElements, ['bg-gray-700']);
        addClasses(cardElements, ['bg-yellow-600', 'shadow-lg']);
        removeClasses(statusElements, ['bg-gray-700']);
        addClasses(statusElements, ['bg-yellow-500', 'text-black', 'font-semibold']);
      } else {
        countdown = remainingCurrent ? `Time remaining in your turn: ${formatDuration(remainingCurrent)}.` : '';
        if (!chargingPauseActive) {
          removeClasses(cardElements, ['bg-gray-700']);
          removeClasses(statusElements, ['bg-gray-700']);
          addClasses(cardElements, ['bg-green-600', 'shadow-lg']);
          addClasses(statusElements, ['bg-green-500', 'text-black', 'font-semibold']);
        }
      }
    } else {
      yourStatus = `You are ${position + 1} of ${queue.length} in line.`;
      if (turnDuration && data.turnExpiresAt) {
        const waitMs = remainingCurrent + Math.max(0, position - 1) * turnDuration;
        countdown = `Estimated time until your turn: ${formatDuration(waitMs)}.`;
      } else {
        countdown = 'Estimated time until your turn: calculating...';
      }
    }
  }

  if (chargingPauseActive) {
    removeClasses(cardElements, ['bg-gray-700']);
    addClasses(cardElements, ['bg-yellow-600']);
    removeClasses(statusElements, ['bg-gray-700']);
    addClasses(statusElements, ['bg-yellow-500', 'text-black', 'font-semibold']);

    const reasonLabel =
      chargingPauseReason === 'battery-charging'
        ? 'Battery charging'
        : chargingPauseReason === 'battery-low'
          ? 'Battery low'
          : 'Turns paused';

    const resumeInstruction =
      chargingPauseReason === 'battery-low'
        ? 'Turns resume automatically once the battery recovers.'
        : 'Turns resume automatically after charging completes.';

    if (position === 0) {
      yourStatus =
        chargingPauseReason === 'battery-low'
          ? 'Battery low. Please dock the rover. You will be first once turns resume.'
          : `${reasonLabel}. You will be first once turns resume.`;
    } else if (position > 0) {
      yourStatus = `${reasonLabel}. You remain ${position + 1} in line.`;
    } else {
      yourStatus =
        chargingPauseReason === 'battery-low'
          ? 'Battery low. Please dock the rover to keep the queue moving.'
          : `${reasonLabel}. Please keep the rover docked until it finishes.`;
    }
    countdown = resumeInstruction;
  }

  setTextAll(statusElements, yourStatus);
  setTextAll(countdownElements, countdown);
});
