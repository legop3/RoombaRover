const LayoutState = Object.freeze({
  DESKTOP: 'desktop',
  MOBILE_PORTRAIT: 'mobile-portrait',
  MOBILE_LANDSCAPE: 'mobile-landscape',
});

const desktopQuery = window.matchMedia('(min-width: 1024px)');
const landscapeQuery = window.matchMedia('(orientation: landscape)');
const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
const anyCoarsePointerQuery = window.matchMedia('(any-pointer: coarse)');
const smallDeviceWidthQuery = window.matchMedia('(max-device-width: 1024px)');

function isTouchDevice() {
  if (coarsePointerQuery.matches || anyCoarsePointerQuery.matches) {
    return true;
  }

  if (typeof navigator !== 'undefined') {
    if (navigator.maxTouchPoints > 1) {
      return true;
    }

    if (navigator.userAgentData?.mobile) {
      return true;
    }

    if ('ontouchstart' in window) {
      return true;
    }

    const ua = String(navigator.userAgent || '').toLowerCase();
    if (/iphone|ipad|ipod|android|windows phone|mobile|silk/.test(ua)) {
      return true;
    }

    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
      return true;
    }
  }

  return false;
}

function isCompactViewport() {
  const minViewport = Math.min(window.innerWidth || Infinity, window.innerHeight || Infinity);
  const screen = window.screen;
  const screenMin = screen ? Math.min(screen.width || Infinity, screen.height || Infinity) : Infinity;

  return minViewport <= 1000 || screenMin <= 1000 || smallDeviceWidthQuery.matches;
}

function isPhysicallySmall() {
  const dpr = window.devicePixelRatio || 1;
  const width = (window.innerWidth || Infinity) / dpr;
  const height = (window.innerHeight || Infinity) / dpr;
  return Math.min(width, height) <= 800;
}

function isShortLandscape() {
  const shortSide = Math.min(window.innerWidth || Infinity, window.innerHeight || Infinity);
  return landscapeQuery.matches && shortSide <= 820;
}

function addMediaListener(query, handler) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }

  if (typeof query.addListener === 'function') {
    query.addListener(handler);
    return () => query.removeListener(handler);
  }

  return () => {};
}

function getLayoutState() {
  const prefersMobile =
    isTouchDevice() || isCompactViewport() || isPhysicallySmall() || isShortLandscape();

  if (prefersMobile) {
    return landscapeQuery.matches ? LayoutState.MOBILE_LANDSCAPE : LayoutState.MOBILE_PORTRAIT;
  }

  if (desktopQuery.matches) {
    return LayoutState.DESKTOP;
  }

  return landscapeQuery.matches ? LayoutState.MOBILE_LANDSCAPE : LayoutState.MOBILE_PORTRAIT;
}

function subscribeMedia(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }

  const handler = () => {
    callback(getLayoutState());
  };

  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  const removeDesktop = addMediaListener(desktopQuery, handler);
  const removeLandscape = addMediaListener(landscapeQuery, handler);
  const removePointer = addMediaListener(coarsePointerQuery, handler);
  const removeAnyPointer = addMediaListener(anyCoarsePointerQuery, handler);
  const removeDeviceWidth = addMediaListener(smallDeviceWidthQuery, handler);

  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    removeDesktop();
    removeLandscape();
    removePointer();
    removeAnyPointer();
    removeDeviceWidth();
  };
}

export { LayoutState, getLayoutState, subscribeMedia };
