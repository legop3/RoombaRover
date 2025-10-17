const layoutDefault = document.getElementById('layout-default');
const layoutLandscape = document.getElementById('layout-landscape');
const fullscreenControls = document.getElementById('fullscreen-controls');
const fullscreenTrigger = document.getElementById('fullscreen-trigger');

const LayoutState = Object.freeze({
  DESKTOP: 'desktop',
  MOBILE_PORTRAIT: 'mobile-portrait',
  MOBILE_LANDSCAPE: 'mobile-landscape',
});

const desktopQuery = window.matchMedia('(min-width: 1024px)'); // Tailwind lg breakpoint
const landscapeQuery = window.matchMedia('(orientation: landscape)');
let currentState = null;
let fullscreenRequested = false;

function determineLayoutState() {
  if (desktopQuery.matches) {
    return LayoutState.DESKTOP;
  }

  return landscapeQuery.matches ? LayoutState.MOBILE_LANDSCAPE : LayoutState.MOBILE_PORTRAIT;
}

function toggleVisibility(element, visible) {
  if (!element) return;
  element.classList.toggle('hidden', !visible);
}

function getRequestFullscreen(root) {
  return (
    root.requestFullscreen ||
    root.webkitRequestFullscreen ||
    root.mozRequestFullScreen ||
    root.msRequestFullscreen
  );
}

function getExitFullscreen() {
  return (
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen
  );
}

async function enterFullscreen() {
  if (document.fullscreenElement || fullscreenRequested) return;
  const root = document.documentElement;

  const requestFullscreen = getRequestFullscreen(root);
  if (!requestFullscreen) {
    toggleVisibility(fullscreenControls, true);
    return;
  }

  fullscreenRequested = true;

  try {
    const result = requestFullscreen.call(root, { navigationUI: 'hide' });
    if (result instanceof Promise) {
      await result;
    }
    toggleVisibility(fullscreenControls, false);
  } catch (error) {
    fullscreenRequested = false;
    toggleVisibility(fullscreenControls, true);
  }
}

async function exitFullscreen() {
  const exitFullscreen = getExitFullscreen();
  if (!exitFullscreen) {
    fullscreenRequested = false;
    return;
  }

  if (
    !document.fullscreenElement &&
    !document.webkitFullscreenElement &&
    !document.mozFullScreenElement &&
    !document.msFullscreenElement
  ) {
    fullscreenRequested = false;
    return;
  }

  try {
    const result = exitFullscreen.call(document);
    if (result instanceof Promise) {
      await result;
    }
  } catch (error) {
    // Ignore failures; user can exit manually.
  } finally {
    fullscreenRequested = false;
  }
}

function applyLayout(state) {
  if (state === currentState) return;

  currentState = state;

  switch (state) {
    case LayoutState.DESKTOP:
      toggleVisibility(layoutDefault, true);
      toggleVisibility(layoutLandscape, false);
      toggleVisibility(fullscreenControls, false);
      exitFullscreen();
      break;

    case LayoutState.MOBILE_PORTRAIT:
      toggleVisibility(layoutDefault, true);
      toggleVisibility(layoutLandscape, false);
      toggleVisibility(fullscreenControls, false);
      exitFullscreen();
      break;

    case LayoutState.MOBILE_LANDSCAPE:
      toggleVisibility(layoutDefault, false);
      toggleVisibility(layoutLandscape, true);
      enterFullscreen();
      break;

    default:
      break;
  }
}

function handleLayoutUpdate() {
  const nextState = determineLayoutState();
  applyLayout(nextState);
}

fullscreenTrigger?.addEventListener('click', () => {
  enterFullscreen();
});

function handleFullscreenChange() {
  if (
    !document.fullscreenElement &&
    !document.webkitFullscreenElement &&
    !document.mozFullScreenElement &&
    !document.msFullscreenElement
  ) {
    fullscreenRequested = false;
  }
}

window.addEventListener('resize', handleLayoutUpdate);
window.addEventListener('orientationchange', handleLayoutUpdate);
desktopQuery.addEventListener('change', handleLayoutUpdate);
landscapeQuery.addEventListener('change', handleLayoutUpdate);
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

handleLayoutUpdate();
