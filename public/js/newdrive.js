const LAYOUT_PARAM = 'layout';
const PORTRAIT_PATH = '/newdrive/portrait/';
const LANDSCAPE_PATH = '/newdrive/landscape/';

const orientationQuery = window.matchMedia('(orientation: landscape)');
const mobileWidthQuery = window.matchMedia('(max-width: 1024px)');

function getForcedLayout() {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get(LAYOUT_PARAM);
  if (forced === 'portrait' || forced === 'landscape') {
    params.delete(LAYOUT_PARAM);
    const query = params.toString();
    return { layout: forced, query };
  }
  return null;
}

function computeLayout() {
  const forced = getForcedLayout();
  if (forced) {
    return forced;
  }

  const layout = !mobileWidthQuery.matches
    ? 'portrait'
    : orientationQuery.matches
      ? 'landscape'
      : 'portrait';

  const params = new URLSearchParams(window.location.search);
  params.delete(LAYOUT_PARAM);
  return { layout, query: params.toString() };
}

function buildTargetUrl(layout, query) {
  const base = layout === 'landscape' ? LANDSCAPE_PATH : PORTRAIT_PATH;
  const hash = window.location.hash || '';
  return query ? `${base}?${query}${hash}` : `${base}${hash}`;
}

function redirectIfNeeded() {
  const { layout, query } = computeLayout();
  const targetUrl = buildTargetUrl(layout, query);

  if (window.location.pathname.startsWith(layout === 'landscape' ? LANDSCAPE_PATH : PORTRAIT_PATH)) {
    // Already on the desired layout; no redirect.
    return;
  }

  window.location.replace(targetUrl);
}

redirectIfNeeded();
