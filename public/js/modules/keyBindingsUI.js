import {
  assignKey,
  formatKeyForDisplay,
  getActionDefinitions,
  getBindingsSnapshot,
  normalizeEventKey,
  removeKey,
  resetAction,
  resetAll,
  setCaptureInProgress,
  subscribe,
} from './keyBindings.js';

const ROOT_SELECTOR = '[data-keybindings-root]';

let root;
let listContainer;
let statusElement;
let resetAllButton;

let bindings = {};
let actionDefinitions = [];
let captureActionId = null;
let captureListener = null;

function init() {
  root = document.querySelector(ROOT_SELECTOR);
  if (!root) return;

  listContainer = root.querySelector('[data-keybindings-list]');
  statusElement = root.querySelector('[data-keybindings-status]');
  resetAllButton = root.querySelector('[data-keybindings-reset-all]');

  actionDefinitions = getActionDefinitions();
  bindings = getBindingsSnapshot();

  if (resetAllButton) {
    resetAllButton.addEventListener('click', handleResetAll);
  }

  subscribe(({ bindings: nextBindings }) => {
    bindings = nextBindings;
    render();
  });

  render();
}

function render() {
  if (!listContainer) return;
  listContainer.replaceChildren();

  actionDefinitions.forEach((action) => {
    const row = createActionRow(action, bindings[action.id] || []);
    listContainer.appendChild(row);
  });
}

function createActionRow(action, keys) {
  const row = document.createElement('div');
  row.dataset.actionId = action.id;
  row.className =
    'bg-gray-700 rounded-xl p-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2';

  if (captureActionId === action.id) {
    row.classList.add('ring-2', 'ring-blue-500');
  }

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex-1';

  const title = document.createElement('p');
  title.className = 'text-sm font-semibold';
  title.textContent = action.label;

  const description = document.createElement('p');
  description.className = 'text-xs text-gray-300';
  description.textContent = action.description;

  infoContainer.append(title, description);

  const controlsContainer = document.createElement('div');
  controlsContainer.className = 'flex flex-wrap items-center gap-2';

  if (!keys.length) {
    const emptyPill = document.createElement('span');
    emptyPill.className =
      'px-2 py-1 text-xs rounded bg-gray-900 text-gray-300 border border-gray-600';
    emptyPill.textContent = 'Not mapped';
    controlsContainer.appendChild(emptyPill);
  } else {
    keys.forEach((key) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className =
        'px-2 py-1 text-xs rounded bg-gray-900 text-white border border-gray-600 hover:bg-red-700 transition-colors';
      pill.textContent = formatKeyForDisplay(key);
      pill.title = 'Remove this keybinding';
      pill.addEventListener('click', () => handleRemoveKey(action.id, key));
      controlsContainer.appendChild(pill);
    });
  }

  const controlsActions = document.createElement('div');
  controlsActions.className = 'flex items-center gap-2';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className =
    'text-xs bg-blue-600 hover:bg-blue-500 text-white rounded px-2 py-1 font-semibold transition-colors';
  addButton.textContent = captureActionId === action.id ? 'Listening…' : 'Add Key';
  addButton.disabled = captureActionId === action.id;
  addButton.addEventListener('click', () => handleAddKey(action.id));

  controlsActions.appendChild(addButton);

  if (captureActionId === action.id) {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className =
      'text-xs bg-gray-600 hover:bg-gray-500 text-white rounded px-2 py-1 transition-colors';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      stopCapturing();
      updateStatus('Key capture cancelled.');
    });
    controlsActions.appendChild(cancelButton);
  } else {
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'text-xs text-gray-300 underline hover:text-white';
    resetButton.textContent = 'Reset';
    resetButton.addEventListener('click', () => handleResetAction(action.id));
    controlsActions.appendChild(resetButton);
  }

  controlsContainer.appendChild(controlsActions);

  row.append(infoContainer, controlsContainer);
  return row;
}

function handleAddKey(actionId) {
  if (captureActionId === actionId) {
    stopCapturing();
    return;
  }

  startCapturing(actionId);
}

function startCapturing(actionId) {
  stopCapturing();
  captureActionId = actionId;
  setCaptureInProgress(true);
  updateStatus(`Press a key to assign to “${getActionLabel(actionId)}”.`);
  captureListener = (event) => {
    if (!captureListener || !captureActionId) return;
    if (event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const key = normalizeEventKey(event);
    if (!key) {
      updateStatus('That key could not be captured. Try another key.');
      return;
    }

    stopCapturing();
    try {
      assignKey(actionId, key);
      updateStatus(
        `Assigned ${formatKeyForDisplay(key)} to “${getActionLabel(actionId)}”.`
      );
    } catch (error) {
      console.error('[keyBindingsUI] Failed to assign key:', error);
      updateStatus('Unable to assign that key. Please try again.', true);
    }
  };

  window.addEventListener('keydown', captureListener, { capture: true });
  render();
}

function stopCapturing() {
  if (!captureActionId) return;
  if (captureListener) {
    window.removeEventListener('keydown', captureListener, { capture: true });
  }
  captureListener = null;
  captureActionId = null;
  setCaptureInProgress(false);
  render();
}

function handleRemoveKey(actionId, key) {
  try {
    removeKey(actionId, key);
    updateStatus(`Removed ${formatKeyForDisplay(key)} from “${getActionLabel(actionId)}”.`);
  } catch (error) {
    console.error('[keyBindingsUI] Failed to remove key:', error);
    updateStatus('Unable to remove that keybinding.', true);
  }
}

function handleResetAction(actionId) {
  stopCapturing();
  const label = getActionLabel(actionId);
  try {
    resetAction(actionId);
    updateStatus(`Reset “${label}” to its default key.`);
  } catch (error) {
    console.error('[keyBindingsUI] Failed to reset keybinding:', error);
    updateStatus('Unable to reset that action right now.', true);
  }
}

function handleResetAll() {
  stopCapturing();
  const confirmed = window.confirm(
    'Reset all keyboard shortcuts to their default keys?'
  );
  if (!confirmed) return;
  try {
    resetAll();
    updateStatus('All keyboard shortcuts were reset to their defaults.');
  } catch (error) {
    console.error('[keyBindingsUI] Failed to reset keybindings:', error);
    updateStatus('Unable to reset keybindings right now.', true);
  }
}

function getActionLabel(actionId) {
  const action = actionDefinitions.find((entry) => entry.id === actionId);
  return action ? action.label : actionId;
}

function updateStatus(message, isError = false) {
  if (!statusElement) return;
  statusElement.textContent = message || '';
  statusElement.classList.remove('hidden', 'text-red-300', 'text-blue-300');
  statusElement.classList.add(isError ? 'text-red-300' : 'text-blue-300');
  if (!message) {
    statusElement.classList.add('hidden');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
