import { LayoutState, getLayoutState, subscribeMedia } from './media.js';
import { exitFullscreen, isFullscreenActive, onFullscreenChange, requestFullscreen } from './fullscreen.js';

function toggleElement(element, visible) {
  if (!element) {
    return;
  }
  element.classList.toggle('hidden', !visible);
}

export function initializeLayout({ layoutDefault, layoutLandscape, fullscreenControls, fullscreenTrigger }) {
  let currentState = null;
  const rootElement = document.documentElement;

  async function activateLandscape() {
    toggleElement(layoutDefault, false);
    toggleElement(layoutLandscape, true);

    const result = await requestFullscreen(rootElement);
    if (result === 'unsupported' || result === 'blocked') {
      toggleElement(fullscreenControls, true);
    } else {
      toggleElement(fullscreenControls, false);
    }
  }

  function activateDefault() {
    toggleElement(layoutDefault, true);
    toggleElement(layoutLandscape, false);
    toggleElement(fullscreenControls, false);
    exitFullscreen();
  }

  function applyLayout(state) {
    if (state === currentState) {
      return;
    }

    currentState = state;

    if (state === LayoutState.MOBILE_LANDSCAPE) {
      activateLandscape();
    } else {
      activateDefault();
    }
  }

  function handleLayoutChange() {
    applyLayout(getLayoutState());
  }

  subscribeMedia(applyLayout);

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
  });

  handleLayoutChange();
}
