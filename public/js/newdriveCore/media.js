const LayoutState = Object.freeze({
  DESKTOP: 'desktop',
  MOBILE_PORTRAIT: 'mobile-portrait',
  MOBILE_LANDSCAPE: 'mobile-landscape',
});

const desktopQuery = window.matchMedia('(min-width: 1024px)');
const landscapeQuery = window.matchMedia('(orientation: landscape)');
const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
const anyCoarsePointerQuery = window.matchMedia('(any-pointer: coarse)');

function isTouchDevice() {
  if (coarsePointerQuery.matches || anyCoarsePointerQuery.matches) {
    return true;
  }

  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) {
    return true;
  }

  if (typeof navigator !== 'undefined') {
    const ua = String(navigator.userAgent || '').toLowerCase();
    if (/iphone|ipad|ipod|android|windows phone|mobile/.test(ua)) {
      return true;
    }
  }

  return false;
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
  const touch = isTouchDevice();

  if (touch) {
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

  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    removeDesktop();
    removeLandscape();
    removePointer();
    removeAnyPointer();
  };
}

export { LayoutState, getLayoutState, subscribeMedia };
