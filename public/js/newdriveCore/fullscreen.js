const fullscreenEvents = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
];

let fullscreenRequested = false;
const listeners = new Set();

function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement,
  );
}

function getRequestMethod(element) {
  return (
    element.requestFullscreen ||
    element.webkitRequestFullscreen ||
    element.mozRequestFullScreen ||
    element.msRequestFullscreen
  );
}

function getExitMethod() {
  return (
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen
  );
}

async function requestFullscreen(element = document.documentElement) {
  if (isFullscreenActive() || fullscreenRequested) {
    return 'already';
  }

  const request = getRequestMethod(element);
  if (!request) {
    return 'unsupported';
  }

  fullscreenRequested = true;

  try {
    const result = request.call(element, { navigationUI: 'hide' });
    if (result instanceof Promise) {
      await result;
    }
    return 'entered';
  } catch (error) {
    fullscreenRequested = false;
    return 'blocked';
  }
}

async function exitFullscreen() {
  const exitMethod = getExitMethod();
  if (!exitMethod) {
    fullscreenRequested = false;
    return;
  }

  if (!isFullscreenActive()) {
    fullscreenRequested = false;
    return;
  }

  try {
    const result = exitMethod.call(document);
    if (result instanceof Promise) {
      await result;
    }
  } catch (error) {
    // Swallow errors; the user can exit manually.
  } finally {
    fullscreenRequested = false;
  }
}

function handleFullscreenEvents() {
  if (!isFullscreenActive()) {
    fullscreenRequested = false;
  }

  listeners.forEach((callback) => {
    callback();
  });
}

fullscreenEvents.forEach((eventName) => {
  document.addEventListener(eventName, handleFullscreenEvents);
});

function onFullscreenChange(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }

  listeners.add(callback);

  return () => {
    listeners.delete(callback);
  };
}

export { exitFullscreen, isFullscreenActive, onFullscreenChange, requestFullscreen };
