import { LayoutState, getLayoutState, subscribeMedia } from './media.js';
import { exitFullscreen, isFullscreenActive, onFullscreenChange, requestFullscreen } from './fullscreen.js';
import { reloadDriveIframes } from './driveIframeManager.js';

function toggleElement(element, visible) {
  if (!element) {
    return;
  }
  element.classList.toggle('hidden', !visible);
}

function getManualOverride() {
  if (typeof window === 'undefined') {
    return null;
  }
  const override = window.__ROVER_LAYOUT_OVERRIDE__;
  if (override === 'mobile-landscape' || override === 'desktop') {
    return override;
  }
  return null;
}

function resolveLayoutState() {
  const override = getManualOverride();
  if (override === 'mobile-landscape') {
    return LayoutState.MOBILE_LANDSCAPE;
  }
  if (override === 'desktop') {
    return LayoutState.DESKTOP;
  }
  return getLayoutState();
}

export function initializeLayout({ layoutDefault, layoutLandscape, fullscreenControls, fullscreenTrigger }) {
  let currentState = null;
  const rootElement = document.documentElement;
  const RELOAD_DEBOUNCE_MS = 250;
  let iframeReloadTimer = null;
  let initialized = false;

  function scheduleIframeReload() {
    if (!initialized) {
      return;
    }

    clearTimeout(iframeReloadTimer);
    iframeReloadTimer = setTimeout(() => {
      reloadDriveIframes();
    }, RELOAD_DEBOUNCE_MS);
  }

  async function activateLandscape() {
    toggleElement(layoutDefault, false);
    toggleElement(layoutLandscape, true);

    const result = await requestFullscreen(rootElement);
    if (result === 'unsupported' || result === 'blocked') {
      toggleElement(fullscreenControls, true);
    } else {
      toggleElement(fullscreenControls, false);
    }

    scheduleIframeReload();
  }

  function activateDefault() {
    toggleElement(layoutDefault, true);
    toggleElement(layoutLandscape, false);
    toggleElement(fullscreenControls, false);
    exitFullscreen();
    scheduleIframeReload();
  }

  function applyLayout(state) {
    const stateChanged = state !== currentState;

    if (stateChanged) {
      currentState = state;

      if (state === LayoutState.MOBILE_LANDSCAPE) {
        activateLandscape();
      } else {
        activateDefault();
      }
    }
  }

  function handleLayoutChange() {
    applyLayout(resolveLayoutState());
    initialized = true;
  }

  subscribeMedia(() => {
    applyLayout(resolveLayoutState());
  });

  if (fullscreenTrigger) {
    fullscreenTrigger.addEventListener('click', () => {
      activateLandscape();
    });
  }

  onFullscreenChange(() => {
    if (currentState === LayoutState.MOBILE_LANDSCAPE && !isFullscreenActive()) {
      toggleElement(fullscreenControls, true);
    } else {
      toggleElement(fullscreenControls, false);
    }

    if (currentState !== LayoutState.MOBILE_LANDSCAPE) {
      exitFullscreen();
    }

    scheduleIframeReload();
  });

  window.addEventListener('rover:layout-override-changed', handleLayoutChange);

  handleLayoutChange();
}
