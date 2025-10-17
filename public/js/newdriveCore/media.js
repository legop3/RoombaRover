const LayoutState = Object.freeze({
  DESKTOP: 'desktop',
  MOBILE_PORTRAIT: 'mobile-portrait',
  MOBILE_LANDSCAPE: 'mobile-landscape',
});

const desktopQuery = window.matchMedia('(min-width: 1024px)');
const landscapeQuery = window.matchMedia('(orientation: landscape)');

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

  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    removeDesktop();
    removeLandscape();
  };
}

export { LayoutState, getLayoutState, subscribeMedia };
