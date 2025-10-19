const STORAGE_KEY = 'newdrive:layout-override';
const root = document.documentElement;

let buttons = [];
let overrideState = null;

function getAutoLabel(button) {
  return button?.dataset?.layoutLabelAuto || 'Layout: Auto (Tap to Force Mobile)';
}

function getMobileLabel(button) {
  return button?.dataset?.layoutLabelMobile || 'Layout: Mobile (Tap to Return to Auto)';
}

function updateButtons() {
  buttons.forEach((button) => {
    if (!button) {
      return;
    }

    const forcedMobile = overrideState === 'mobile';
    button.textContent = forcedMobile ? getMobileLabel(button) : getAutoLabel(button);
    button.setAttribute('aria-pressed', forcedMobile ? 'true' : 'false');
    button.classList.toggle('layout-toggle-active', forcedMobile);
  });
}

function applyOverride(value, { skipStorage = false, silent = false } = {}) {
  overrideState = value === 'mobile' ? 'mobile' : null;

  if (overrideState === 'mobile') {
    root.classList.add('force-mobile');
    window.__ROVER_LAYOUT_OVERRIDE__ = 'mobile-landscape';
  } else {
    root.classList.remove('force-mobile');
    window.__ROVER_LAYOUT_OVERRIDE__ = null;
  }

  if (!skipStorage) {
    try {
      if (overrideState) {
        localStorage.setItem(STORAGE_KEY, overrideState);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.warn('[layoutToggle] Unable to persist layout preference', error);
    }
  }

  updateButtons();

  if (!silent) {
    window.dispatchEvent(new CustomEvent('rover:layout-override-changed'));
  }
}

function toggleOverride() {
  applyOverride(overrideState === 'mobile' ? null : 'mobile');
}

function loadStoredOverride() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    stored = null;
  }

  applyOverride(stored === 'mobile' ? 'mobile' : null, { skipStorage: true, silent: true });
  updateButtons();
  window.dispatchEvent(new CustomEvent('rover:layout-override-changed'));
}

function init() {
  buttons = Array.from(document.querySelectorAll('[data-layout-toggle]'));
  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      toggleOverride();
    });
  });

  loadStoredOverride();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
