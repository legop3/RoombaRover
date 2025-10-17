import { initializeDriveIframes } from './newdriveCore/driveIframeManager.js';
import { initializeTabs } from './newdriveCore/tabs.js';

const LANDSCAPE_PATH = '/newdrive/landscape/';
const orientationQuery = window.matchMedia('(orientation: landscape)');
const mobileWidthQuery = window.matchMedia('(max-width: 1024px)');

function ensureToastContainer() {
  if (document.getElementById('toast-container')) {
    return;
  }
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'fixed top-5 left-1/2 transform -translate-x-1/2 z-50 flex flex-col items-center space-y-2 pointer-events-none';
  document.body.appendChild(container);
}

function buildUrl(base) {
  const params = new URLSearchParams(window.location.search);
  params.delete('layout');
  const query = params.toString();
  const hash = window.location.hash || '';
  return query ? `${base}?${query}${hash}` : `${base}${hash}`;
}

function maybeRedirectToLandscape() {
  if (mobileWidthQuery.matches && orientationQuery.matches) {
    window.location.replace(buildUrl(LANDSCAPE_PATH));
  }
}

async function boot() {
  ensureToastContainer();

  try {
    await import('./modules/socketGlobal.js');
    await Promise.all([
      import('./modules/adminLogin.js'),
      import('./modules/homeAssistantLights.js'),
      import('./modules/roomCamera.js'),
      import('./modules/presence.js'),
      import('./modules/adminControls.js')
    ]);
  } catch (error) {
    console.error('Failed to load one or more portrait modules:', error);
  }

  initializeDriveIframes();
  initializeTabs();
  maybeRedirectToLandscape();

  const orientationListener = () => maybeRedirectToLandscape();
  const widthListener = () => maybeRedirectToLandscape();

  if (typeof orientationQuery.addEventListener === 'function') {
    orientationQuery.addEventListener('change', orientationListener);
  } else if (typeof orientationQuery.addListener === 'function') {
    orientationQuery.addListener(orientationListener);
  }

  if (typeof mobileWidthQuery.addEventListener === 'function') {
    mobileWidthQuery.addEventListener('change', widthListener);
  } else if (typeof mobileWidthQuery.addListener === 'function') {
    mobileWidthQuery.addListener(widthListener);
  }
}

boot();
