const gestureEvents = ['click', 'keydown', 'pointerdown', 'touchstart'];
const resizeCheckDelays = [500, 1500, 4000];
const RESIZE_RELOAD_THRESHOLD = 120;
const RESIZE_DEBOUNCE_MS = 350;

const controllers = new Set();

let gestureListenersAttached = false;
let resizeDebounceTimer = null;
let orientationReloadTimer = null;
let viewportSnapshot = {
  width: window.innerWidth,
  height: window.innerHeight,
};

let videoUrl = null;
let videoUrlPromise = null;
let managerInitialized = false;

function attachGlobalGestureListeners() {
  if (gestureListenersAttached) {
    return;
  }

  gestureListenersAttached = true;
  gestureEvents.forEach((eventType) => {
    document.addEventListener(eventType, handleGlobalGesture, true);
  });
}

function detachGlobalGestureListenersIfIdle() {
  if (!Array.from(controllers).some((controller) => controller.needsGesture)) {
    gestureListenersAttached = false;
    gestureEvents.forEach((eventType) => {
      document.removeEventListener(eventType, handleGlobalGesture, true);
    });
  }
}

function handleGlobalGesture(event) {
  controllers.forEach((controller) => {
    if (controller.needsGesture) {
      controller.tryUnmute({ reason: `gesture:${event.type}` });
    }
  });
}

class DriveIframeController {
  constructor(iframe) {
    this.iframe = iframe;
    this.needsGesture = true;
    this.unmuteRetryTimer = null;
    this.resizeCorsWarningShown = false;
    this.videoCorsWarningShown = false;

    this.handleLoad = this.onIframeLoad.bind(this);
    this.handleFocus = this.onIframeFocus.bind(this);

    this.disableInteraction();
    iframe.addEventListener('load', this.handleLoad);
  }

  disableInteraction() {
    this.iframe.setAttribute('tabindex', '-1');
    this.iframe.style.pointerEvents = 'none';
    this.iframe.addEventListener('focus', this.handleFocus, true);
  }

  onIframeFocus(event) {
    event.preventDefault();
    this.iframe.blur();
    if (typeof window.focus === 'function') {
      window.focus();
    }
  }

  setSource(url, { reload = false } = {}) {
    if (!url) {
      return;
    }

    if (reload || this.iframe.src === url) {
      this.iframe.src = '';
    }

    this.iframe.src = url;
  }

  onIframeLoad() {
    this.resizeIframe();
    this.scheduleResizeChecks();
    this.startUnmuteFlow();
  }

  resizeIframe() {
    try {
      const doc = this.iframe.contentDocument || this.iframe.contentWindow.document;
      const vid = doc?.querySelector('video');

      if (vid && vid.videoWidth && vid.videoHeight) {
        const ratio = vid.videoHeight / vid.videoWidth;
        this.iframe.style.height = `${this.iframe.offsetWidth * ratio}px`;
      } else {
        const fallbackHeight = doc?.body?.scrollHeight || 480;
        this.iframe.style.height = `${fallbackHeight}px`;
      }
    } catch (err) {
      if (!this.resizeCorsWarningShown) {
        console.warn('[driveIframeManager] Unable to access iframe contents for resize (likely CORS).');
        this.resizeCorsWarningShown = true;
      }
    }
  }

  scheduleResizeChecks() {
    resizeCheckDelays.forEach((delay) => {
      setTimeout(() => this.resizeIframe(), delay);
    });
  }

  startUnmuteFlow() {
    this.needsGesture = true;
    attachGlobalGestureListeners();
    this.tryUnmute({ reason: 'initial-load' });
  }

  getIframeVideo() {
    try {
      const doc = this.iframe.contentDocument || this.iframe.contentWindow.document;
      return doc?.querySelector('video') || null;
    } catch (err) {
      if (!this.videoCorsWarningShown) {
        console.warn('[driveIframeManager] Unable to access iframe video element (likely CORS).');
        this.videoCorsWarningShown = true;
      }
      return null;
    }
  }

  tryUnmute({ reason = 'auto' } = {}) {
    const video = this.getIframeVideo();
    if (!video) {
      this.scheduleUnmuteRetry('no-video');
      return;
    }

    video.muted = false;
    video.volume = 1.0;

    const playPromise = video.play?.();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => this.handlePlaySuccess(video))
        .catch((err) => {
          console.warn(`[driveIframeManager] play() blocked (${reason}). Retrying muted.`, err);
          video.muted = true;
          video.play?.().catch(() => {});
          this.scheduleUnmuteRetry('play-blocked');
        });
    } else {
      this.handlePlaySuccess(video);
    }
  }

  handlePlaySuccess(video) {
    if (video.muted) {
      this.scheduleUnmuteRetry('still-muted');
      return;
    }

    console.log('[driveIframeManager] Video playing and unmuted.');
    this.needsGesture = false;
    this.clearUnmuteRetry();
    detachGlobalGestureListenersIfIdle();
    this.scheduleResizeChecks();
  }

  scheduleUnmuteRetry(reason) {
    this.clearUnmuteRetry();
    this.unmuteRetryTimer = setTimeout(() => this.tryUnmute({ reason }), 1000);
  }

  clearUnmuteRetry() {
    clearTimeout(this.unmuteRetryTimer);
    this.unmuteRetryTimer = null;
  }
}

function ensureControllers(selector) {
  const iframes = Array.from(document.querySelectorAll(selector));

  if (!iframes.length) {
    console.warn(`[driveIframeManager] No iframes found for selector "${selector}".`);
  }

  iframes.forEach((iframe) => {
    if (!Array.from(controllers).some((controller) => controller.iframe === iframe)) {
      controllers.add(new DriveIframeController(iframe));
    }
  });
}

async function getVideoUrl({ forceFetch = false } = {}) {
  if (forceFetch) {
    videoUrl = null;
  }

  if (!forceFetch && videoUrl) {
    return videoUrl;
  }

  if (videoUrlPromise) {
    return videoUrlPromise;
  }

  videoUrlPromise = (async () => {
    const response = await fetch('/video-url', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const url = (await response.text()).trim();
    if (!url) {
      throw new Error('Empty video URL returned from /video-url');
    }

    videoUrl = url;
    return url;
  })();

  try {
    return await videoUrlPromise;
  } catch (error) {
    console.error('[driveIframeManager] Failed to load iframe source:', error);
    throw error;
  } finally {
    videoUrlPromise = null;
  }
}

async function applySourceToControllers({ reload = false, forceFetch = false } = {}) {
  try {
    const url = await getVideoUrl({ forceFetch });
    controllers.forEach((controller) => controller.setSource(url, { reload }));
  } catch (error) {
    // Errors already logged in getVideoUrl.
  }
}

function handleViewportResize() {
  if (!managerInitialized) {
    return;
  }

  controllers.forEach((controller) => controller.resizeIframe());

  clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const deltaWidth = Math.abs(width - viewportSnapshot.width);
    const deltaHeight = Math.abs(height - viewportSnapshot.height);

    if (deltaWidth >= RESIZE_RELOAD_THRESHOLD || deltaHeight >= RESIZE_RELOAD_THRESHOLD) {
      viewportSnapshot = { width, height };
      reloadDriveIframes({ reason: 'viewport-change' });
    }
  }, RESIZE_DEBOUNCE_MS);
}

function handleOrientationChange() {
  if (!managerInitialized) {
    return;
  }

  clearTimeout(orientationReloadTimer);
  orientationReloadTimer = setTimeout(() => {
    viewportSnapshot = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    reloadDriveIframes({ reason: 'orientation-change', forceFetch: false });
  }, 250);
}

export function initializeDriveIframes({ selector = '[data-drive-video]' } = {}) {
  ensureControllers(selector);

  if (!controllers.size) {
    return;
  }

  if (!managerInitialized) {
    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    managerInitialized = true;
  }

  viewportSnapshot = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  applySourceToControllers();
}

export function reloadDriveIframes({ forceFetch = false } = {}) {
  if (!controllers.size) {
    return;
  }

  applySourceToControllers({ reload: true, forceFetch });
}
