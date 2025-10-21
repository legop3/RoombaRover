const STORAGE_KEY = 'roomba-keybindings:v1';

const ACTION_DEFINITIONS = [
  {
    id: 'driveForward',
    label: 'Drive Forward',
    description: 'Move the rover forward.',
    defaultKeys: ['w'],
    category: 'driving',
  },
  {
    id: 'driveBackward',
    label: 'Drive Backward',
    description: 'Move the rover backward.',
    defaultKeys: ['s'],
    category: 'driving',
  },
  {
    id: 'driveLeft',
    label: 'Turn Left',
    description: 'Rotate or arc left.',
    defaultKeys: ['a'],
    category: 'driving',
  },
  {
    id: 'driveRight',
    label: 'Turn Right',
    description: 'Rotate or arc right.',
    defaultKeys: ['d'],
    category: 'driving',
  },
  {
    id: 'precisionMode',
    label: 'Precision Mode',
    description: 'Hold for slow precise driving.',
    defaultKeys: ['shift'],
    category: 'driving',
  },
  {
    id: 'turboMode',
    label: 'Turbo Mode',
    description: 'Hold for max speed. Use carefully!',
    defaultKeys: ['\\'],
    category: 'driving',
  },
  {
    id: 'sideBrushForward',
    label: 'Side Brush Forward',
    description: 'Spin the side brush forward.',
    defaultKeys: ['o'],
    category: 'cleaning',
  },
  {
    id: 'sideBrushReverse',
    label: 'Side Brush Reverse',
    description: 'Spin the side brush in reverse.',
    defaultKeys: ['l'],
    category: 'cleaning',
  },
  {
    id: 'vacuumHigh',
    label: 'Vacuum High Speed',
    description: 'Run the vacuum motor at high speed.',
    defaultKeys: ['i'],
    category: 'cleaning',
  },
  {
    id: 'vacuumLow',
    label: 'Vacuum Low Speed',
    description: 'Run the vacuum motor at low speed.',
    defaultKeys: ['k'],
    category: 'cleaning',
  },
  {
    id: 'mainBrushForward',
    label: 'Main Brush Forward',
    description: 'Spin the main brush forward.',
    defaultKeys: ['p'],
    category: 'cleaning',
  },
  {
    id: 'mainBrushReverse',
    label: 'Main Brush Reverse',
    description: 'Spin the main brush in reverse.',
    defaultKeys: [';'],
    category: 'cleaning',
  },
  {
    id: 'allCleaners',
    label: 'All Cleaning Motors',
    description: 'Run the side brush, vacuum, and main brush together.',
    defaultKeys: ['.'],
    category: 'cleaning',
  },
  {
    id: 'chatToggle',
    label: 'Chat Focus / Send',
    description: 'Focus the chat input, or send when already focused.',
    defaultKeys: ['enter'],
    category: 'interface',
  },
];

const actionMapById = ACTION_DEFINITIONS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});

let captureInProgress = false;
let bindings = loadBindings();
let keyToActions = buildKeyLookup(bindings);
const listeners = new Set();

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch (error) {
    console.warn('[keyBindings] Failed to parse stored bindings:', error);
    return null;
  }
}

function loadBindings() {
  const defaults = getDefaultBindings();
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  const stored = safeParse(window.localStorage.getItem(STORAGE_KEY));
  if (!stored || typeof stored !== 'object') {
    return defaults;
  }

  const merged = {};
  ACTION_DEFINITIONS.forEach((action) => {
    const storedKeys = Array.isArray(stored[action.id]) ? stored[action.id] : action.defaultKeys;
    merged[action.id] = normalizeKeyList(storedKeys.length ? storedKeys : action.defaultKeys);
  });
  return merged;
}

function getDefaultBindings() {
  return ACTION_DEFINITIONS.reduce((acc, action) => {
    acc[action.id] = [...action.defaultKeys];
    return acc;
  }, {});
}

function normalizeKeyValue(key) {
  if (!key) return '';
  if (key === ' ') return 'space';
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'spacebar') return 'space';
  if (lower === 'dead' || lower === 'unidentified') return '';
  return lower;
}

function normalizeKeyList(keys) {
  const seen = new Set();
  const normalized = [];
  keys.forEach((key) => {
    const value = normalizeKeyValue(key);
    if (value && !seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  });
  return normalized;
}

function saveBindings() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch (error) {
    console.warn('[keyBindings] Unable to save bindings:', error);
  }
}

function buildKeyLookup(sourceBindings) {
  const lookup = new Map();
  Object.entries(sourceBindings).forEach(([actionId, keys]) => {
    keys.forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, []);
      }
      lookup.get(key).push(actionId);
    });
  });
  return lookup;
}

function emitChange() {
  const payload = {
    bindings: getBindingsSnapshot(),
    keyToActions: getKeyActionMap(),
  };
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error('[keyBindings] listener failed:', error);
    }
  });
}

function updateBindings(updater) {
  const next = updater(structuredClone(bindings));
  bindings = next;
  keyToActions = buildKeyLookup(bindings);
  saveBindings();
  emitChange();
}

function structuredClone(source) {
  return JSON.parse(JSON.stringify(source));
}

function getBindingsSnapshot() {
  return structuredClone(bindings);
}

function getKeyActionMap() {
  return new Map(
    Array.from(keyToActions.entries()).map(([key, actions]) => [key, [...actions]])
  );
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  try {
    listener({
      bindings: getBindingsSnapshot(),
      keyToActions: getKeyActionMap(),
    });
  } catch (error) {
    console.error('[keyBindings] initial listener call failed:', error);
  }
  return () => listeners.delete(listener);
}

function assertAction(actionId) {
  if (!actionMapById[actionId]) {
    throw new Error(`Unknown action id: ${actionId}`);
  }
}

function assignKey(actionId, rawKey) {
  assertAction(actionId);
  const key = normalizeKeyValue(rawKey);
  if (!key) {
    throw new Error('Cannot assign empty key.');
  }

  updateBindings((draft) => {
    Object.keys(draft).forEach((id) => {
      if (id === actionId) return;
      draft[id] = draft[id].filter((existing) => existing !== key);
    });
    const keys = new Set(draft[actionId] || []);
    keys.add(key);
    draft[actionId] = Array.from(keys);
    return draft;
  });
}

function removeKey(actionId, rawKey) {
  assertAction(actionId);
  const key = normalizeKeyValue(rawKey);
  if (!key) return;
  updateBindings((draft) => {
    draft[actionId] = (draft[actionId] || []).filter((existing) => existing !== key);
    return draft;
  });
}

function resetAction(actionId) {
  assertAction(actionId);
  updateBindings((draft) => {
    draft[actionId] = [...actionMapById[actionId].defaultKeys];
    return draft;
  });
}

function resetAll() {
  updateBindings(() => getDefaultBindings());
}

function getActionsForKey(key) {
  if (!key) return [];
  return keyToActions.get(key) ? [...keyToActions.get(key)] : [];
}

function normalizeEventKey(event) {
  if (!event || typeof event.key !== 'string') return '';
  return normalizeKeyValue(event.key);
}

function formatKeyForDisplay(key) {
  if (!key) return '';
  const dictionary = {
    space: 'Space',
    shift: 'Shift',
    enter: 'Enter',
    tab: 'Tab',
    control: 'Control',
    alt: 'Alt',
    meta: 'Meta',
    capslock: 'Caps Lock',
    backspace: 'Backspace',
    delete: 'Delete',
    arrowup: 'Arrow Up',
    arrowdown: 'Arrow Down',
    arrowleft: 'Arrow Left',
    arrowright: 'Arrow Right',
  };
  if (dictionary[key]) {
    return dictionary[key];
  }
  if (key.length === 1) {
    if (/[a-z0-9]/.test(key)) {
      return key.toUpperCase();
    }
    return key;
  }
  return key
    .split(/[-_ ]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function getActionDefinitions() {
  return ACTION_DEFINITIONS.map((action) => ({ ...action, defaultKeys: [...action.defaultKeys] }));
}

function isCaptureInProgress() {
  return captureInProgress;
}

function setCaptureInProgress(active) {
  captureInProgress = Boolean(active);
}

export {
  assignKey,
  getActionDefinitions,
  getActionsForKey,
  getBindingsSnapshot,
  getKeyActionMap,
  formatKeyForDisplay,
  isCaptureInProgress,
  normalizeEventKey,
  normalizeKeyValue,
  removeKey,
  resetAction,
  resetAll,
  setCaptureInProgress,
  subscribe,
};
