const mobileQuery = window.matchMedia('(max-width: 1024px)');
const orientationQuery = window.matchMedia('(orientation: landscape)');
const DEFAULT_PROMPT_MESSAGE = 'Tap the button below to enter fullscreen mode.';
const UNSUPPORTED_PROMPT_MESSAGE =
  'Fullscreen is limited on this browser. Use the button below, or hide Safari\'s toolbar from the "AA" menu for more space.';

let overlayElement = null;
let messageElement = null;
let dismissedUntil = 0;

function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
  );
}

function fullscreenSupported() {
  const root = document.documentElement;
  return Boolean(
    root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      root.mozRequestFullScreen ||
      root.msRequestFullscreen
  );
}

function isMobileDevice() {
  return mobileQuery.matches;
}

function shouldShowPrompt() {
  if (!isMobileDevice()) {
    return false;
  }

  if (Date.now() < dismissedUntil) {
    return false;
  }

  return !isFullscreenActive();
}

function ensureOverlay() {
  if (overlayElement) {
    return;
  }

  overlayElement = document.createElement('div');
  overlayElement.id = 'fullscreen-prompt';
  overlayElement.className =
    'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 hidden';

  const panel = document.createElement('div');
  panel.className =
    'bg-gray-900 text-white rounded-2xl px-4 py-5 mx-4 max-w-sm w-full flex flex-col items-center gap-3 shadow-2xl';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const heading = document.createElement('p');
  heading.className = 'text-lg font-semibold text-center';
  heading.textContent = 'For the best experience, use fullscreen.';
  heading.id = 'fullscreen-prompt-title';
  panel.setAttribute('aria-labelledby', heading.id);

  messageElement = document.createElement('p');
  messageElement.className = 'text-sm text-gray-300 text-center';
  messageElement.textContent = DEFAULT_PROMPT_MESSAGE;

  const buttonRow = document.createElement('div');
  buttonRow.className = 'flex flex-col sm:flex-row gap-2 w-full';

  const enterButton = document.createElement('button');
  enterButton.type = 'button';
  enterButton.className =
    'bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-xl w-full transition-colors';
  enterButton.textContent = 'Enter Fullscreen';
  enterButton.addEventListener('click', () => {
    requestFullscreen()
      .then((result) => {
        if (result === 'unsupported') {
          showMessage(
            'Fullscreen is not supported on this browser. You can continue without it.'
          );
          hidePrompt({ dismissMs: 30000 });
        } else if (result === 'blocked') {
          showMessage(
            'Fullscreen was blocked. Please allow fullscreen or use your browser share menu.'
          );
        }
      })
      .catch(() => {
        showMessage(
          'Unable to enter fullscreen. Try again, or enable it from your browser controls.'
        );
      });
  });

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.className =
    'bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 rounded-xl w-full transition-colors';
  skipButton.textContent = 'Maybe later';
  skipButton.addEventListener('click', () => {
    hidePrompt({ dismissMs: 60000 });
  });

  buttonRow.appendChild(enterButton);
  buttonRow.appendChild(skipButton);

  panel.appendChild(heading);
  panel.appendChild(messageElement);
  panel.appendChild(buttonRow);
  overlayElement.appendChild(panel);
  document.body.appendChild(overlayElement);
}

function showPrompt() {
  ensureOverlay();
  if (!overlayElement) {
    return;
  }

  showMessage(fullscreenSupported() ? DEFAULT_PROMPT_MESSAGE : UNSUPPORTED_PROMPT_MESSAGE);
  overlayElement.classList.remove('hidden');
}

function hidePrompt({ dismissMs = 0 } = {}) {
  if (!overlayElement) {
    return;
  }

  overlayElement.classList.add('hidden');
  if (dismissMs > 0) {
    dismissedUntil = Date.now() + dismissMs;
  }
}

function showMessage(text) {
  if (messageElement) {
    messageElement.textContent = text;
  }
}

function requestFullscreen() {
  const root = document.documentElement;

  return new Promise((resolve, reject) => {
    const request =
      root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      root.mozRequestFullScreen ||
      root.msRequestFullscreen;

    if (!request) {
      resolve('unsupported');
      return;
    }

    try {
      const result = request.call(root);
      if (result && typeof result.then === 'function') {
        result
          .then(() => resolve('entered'))
          .catch((error) => {
            if (error && String(error).toLowerCase().includes('denied')) {
              resolve('blocked');
            } else {
              reject(error);
            }
          });
      } else {
        resolve('entered');
      }
    } catch (error) {
      if (error && String(error).toLowerCase().includes('denied')) {
        resolve('blocked');
      } else {
        reject(error);
      }
    }
  });
}

function evaluatePrompt() {
  if (shouldShowPrompt()) {
    showPrompt();
  } else {
    hidePrompt();
  }
}

function handleFullscreenChange() {
  if (isFullscreenActive()) {
    hidePrompt({ dismissMs: 300000 });
  } else {
    evaluatePrompt();
  }
}

function registerEvents() {
  const handleMediaChange = () => {
    setTimeout(evaluatePrompt, 150);
  };

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', handleMediaChange);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(handleMediaChange);
  }

  if (typeof orientationQuery.addEventListener === 'function') {
    orientationQuery.addEventListener('change', handleMediaChange);
  } else if (typeof orientationQuery.addListener === 'function') {
    orientationQuery.addListener(handleMediaChange);
  }

  window.addEventListener('resize', handleMediaChange);
  window.addEventListener('orientationchange', handleMediaChange);

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

function initialize() {
  ensureOverlay();
  registerEvents();
  evaluatePrompt();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
