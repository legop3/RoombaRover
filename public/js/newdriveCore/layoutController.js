import { LayoutState, getLayoutState, subscribeMedia } from './media.js';
import { exitFullscreen, isFullscreenActive, onFullscreenChange, requestFullscreen } from './fullscreen.js';
import { loadIframeSource, reloadIframe } from '../modules/iframeAutomation.js';

function toggleElement(element, visible) {
  if (!element) {
    return;
  }
  element.classList.toggle('hidden', !visible);
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
      reloadIframe();
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
    } else {
      scheduleIframeReload();
    }
  }

  function handleLayoutChange() {
    applyLayout(getLayoutState());
    initialized = true;
  }

  subscribeMedia((state) => {
    applyLayout(state);
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

  handleLayoutChange();
  loadIframeSource();
}
