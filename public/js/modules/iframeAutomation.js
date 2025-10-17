console.log('iframeAutomation module loaded');

const iframe = document.getElementById('avFrame');
const gestureEvents = ['click', 'keydown', 'pointerdown', 'touchstart'];
const UNMUTE_RETRY_DELAY = 1000;

let unmuteRetryTimer = null;
let gestureListenersAttached = false;
let resizeCorsWarningShown = false;
let videoCorsWarningShown = false;

if (!iframe) {
    console.warn('[iframeAutomation] No iframe with id "avFrame" found.');
} else {
    disableIframeInteraction();
    iframe.addEventListener('load', onIframeLoad);
    window.addEventListener('resize', resizeIframe);
    loadIframeSource();
}

function disableIframeInteraction() {
    iframe.setAttribute('tabindex', '-1');
    iframe.style.pointerEvents = 'none';
    iframe.addEventListener('focus', handleIframeFocus, true);
}

function handleIframeFocus(event) {
    event.preventDefault();
    iframe.blur();
    if (typeof window.focus === 'function') {
        window.focus();
    }
}

async function loadIframeSource() {
    try {
        const response = await fetch('/video-url', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const url = (await response.text()).trim();
        if (!url) {
            throw new Error('Empty video URL returned from /video-url');
        }

        iframe.src = url;
    } catch (err) {
        console.error('[iframeAutomation] Failed to load iframe source:', err);
    }
}

function onIframeLoad() {
    resizeIframe();
    scheduleResizeChecks();
    startUnmuteFlow();
}

function resizeIframe() {
    try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const vid = doc?.querySelector('video');

        if (vid && vid.videoWidth && vid.videoHeight) {
            const ratio = vid.videoHeight / vid.videoWidth;
            iframe.style.height = `${iframe.offsetWidth * ratio}px`;
        } else {
            const fallbackHeight = doc?.body?.scrollHeight || 480;
            iframe.style.height = `${fallbackHeight}px`;
        }
    } catch (err) {
        if (!resizeCorsWarningShown) {
            console.warn('Cannot access iframe contents for resize (likely CORS).');
            resizeCorsWarningShown = true;
        }
    }
}

function scheduleResizeChecks() {
    [500, 1500, 4000].forEach(delay => setTimeout(resizeIframe, delay));
}

function startUnmuteFlow() {
    attachGestureListeners();
    tryUnmute({ reason: 'initial-load' });
}

function getIframeVideo() {
    try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        return doc?.querySelector('video') || null;
    } catch (err) {
        if (!videoCorsWarningShown) {
            console.warn('Cannot access iframe contents for video element (likely CORS).');
            videoCorsWarningShown = true;
        }
        return null;
    }
}

function tryUnmute({ reason = 'auto' } = {}) {
    const video = getIframeVideo();
    if (!video) {
        scheduleUnmuteRetry('no-video');
        return;
    }

    video.muted = false;
    video.volume = 1.0;

    const playPromise = video.play?.();
    if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => handlePlaySuccess(video)).catch(err => {
            console.warn(`[iframeAutomation] play() blocked (${reason}). Retrying muted.`, err);
            video.muted = true;
            video.play?.().catch(() => {});
            scheduleUnmuteRetry('play-blocked');
        });
    } else {
        handlePlaySuccess(video);
    }
}

function handlePlaySuccess(video) {
    if (video.muted) {
        scheduleUnmuteRetry('still-muted');
        return;
    }

    console.log('[iframeAutomation] Video playing and unmuted.');
    clearUnmuteRetry();
    detachGestureListeners();
    scheduleResizeChecks();
}

function scheduleUnmuteRetry(reason) {
    clearTimeout(unmuteRetryTimer);
    unmuteRetryTimer = setTimeout(() => tryUnmute({ reason }), UNMUTE_RETRY_DELAY);
}

function clearUnmuteRetry() {
    clearTimeout(unmuteRetryTimer);
    unmuteRetryTimer = null;
}

function attachGestureListeners() {
    if (gestureListenersAttached) {
        return;
    }

    gestureListenersAttached = true;
    gestureEvents.forEach(eventType =>
        document.addEventListener(eventType, onUserGesture, true)
    );
}

function detachGestureListeners() {
    if (!gestureListenersAttached) {
        return;
    }

    gestureListenersAttached = false;
    gestureEvents.forEach(eventType =>
        document.removeEventListener(eventType, onUserGesture, true)
    );
}

function onUserGesture(event) {
    tryUnmute({ reason: `gesture:${event.type}` });
}

export {
    onIframeLoad,
    loadIframeSource
}