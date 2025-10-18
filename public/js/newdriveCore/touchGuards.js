const DOUBLE_TAP_THRESHOLD_MS = 300;
let lastTouchEndTime = 0;

function preventDoubleTapZoom(event) {
  const now = Date.now();
  if (now - lastTouchEndTime <= DOUBLE_TAP_THRESHOLD_MS) {
    event.preventDefault();
  }
  lastTouchEndTime = now;
}

function preventGesture(event) {
  event.preventDefault();
}

function initializeTouchGuards() {
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false });
  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTouchGuards, { once: true });
} else {
  initializeTouchGuards();
}
