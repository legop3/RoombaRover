const STAGE_CLASS = 'mobile-landscape-active';

function initLandscapeLayout() {
    const layout = document.getElementById('newdrive-layout');
    const stage = document.getElementById('landscape-stage');
    const stageControls = document.getElementById('landscape-controls');
    const stageCenter = document.getElementById('landscape-center');
    const stageJoystick = document.getElementById('landscape-joystick');

    if (!layout || !stage || !stageControls || !stageCenter || !stageJoystick) {
        return;
    }

    const anchors = {
        controls: document.getElementById('controls-card-anchor'),
        turnQueue: document.getElementById('turn-queue-card-anchor'),
        joystick: document.getElementById('joystick-card-anchor'),
        video: document.getElementById('video-hud-anchor'),
        logs: document.getElementById('logs-card-anchor')
    };

    const elements = {
        controls: document.getElementById('controls-card'),
        turnQueue: document.getElementById('turn-queue-card'),
        joystick: document.getElementById('joystick-card'),
        video: document.getElementById('video-hud-card'),
        logs: document.getElementById('logs-card')
    };

    const allAnchorsPresent = Object.values(anchors).every(Boolean);
    const allElementsPresent = Object.values(elements).every(Boolean);
    if (!allAnchorsPresent || !allElementsPresent) {
        return;
    }

    let isActive = false;
    let fullscreenPending = false;
    let fullscreenRequested = false;

    const isTouchDevice = () => (
        'ontouchstart' in window ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
        window.matchMedia('(pointer: coarse)').matches
    );

    const narrowQuery = window.matchMedia('(max-width: 1024px)');
    const landscapeQuery = window.matchMedia('(orientation: landscape)');

    const shouldActivate = () => isTouchDevice() && narrowQuery.matches && landscapeQuery.matches;

    const moveToStage = () => {
        stageControls.appendChild(elements.controls);
        stageControls.appendChild(elements.turnQueue);
        stageCenter.appendChild(elements.video);
        stageCenter.appendChild(elements.logs);
        stageJoystick.appendChild(elements.joystick);
    };

    const moveToAnchors = () => {
        anchors.controls.appendChild(elements.controls);
        anchors.turnQueue.appendChild(elements.turnQueue);
        anchors.video.appendChild(elements.video);
        anchors.logs.appendChild(elements.logs);
        anchors.joystick.appendChild(elements.joystick);
    };

    const requestFullscreen = () => {
        if (document.fullscreenElement || fullscreenRequested) {
            fullscreenPending = false;
            return;
        }
        const root = document.documentElement;
        if (!root || typeof root.requestFullscreen !== 'function') {
            fullscreenPending = false;
            return;
        }
        root.requestFullscreen().then(() => {
            fullscreenRequested = true;
            fullscreenPending = false;
        }).catch(err => {
            console.debug('Fullscreen request rejected', err);
            fullscreenPending = false;
        });
    };

    const scheduleFullscreen = () => {
        if (!shouldActivate() || document.fullscreenElement) {
            fullscreenPending = false;
            return;
        }
        fullscreenPending = true;
    };

    const handleGesture = () => {
        if (fullscreenPending) {
            requestFullscreen();
        }
    };

    const activate = () => {
        if (isActive) return;
        isActive = true;
        document.body.classList.add(STAGE_CLASS);
        moveToStage();
        scheduleFullscreen();
    };

    const deactivate = () => {
        if (!isActive) return;
        isActive = false;
        document.body.classList.remove(STAGE_CLASS);
        moveToAnchors();
        fullscreenPending = false;
        if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
            document.exitFullscreen().catch(err => {
                console.debug('Unable to exit fullscreen', err);
            });
        }
        fullscreenRequested = false;
    };

    const evaluate = () => {
        if (shouldActivate()) {
            activate();
        } else {
            deactivate();
        }
    };

    evaluate();

    const resizeHandler = () => evaluate();
    const orientationHandler = () => evaluate();

    window.addEventListener('resize', resizeHandler);
    window.addEventListener('orientationchange', orientationHandler);

    if (landscapeQuery.addEventListener) {
        landscapeQuery.addEventListener('change', evaluate);
    } else if (landscapeQuery.addListener) {
        landscapeQuery.addListener(evaluate);
    }

    if (narrowQuery.addEventListener) {
        narrowQuery.addEventListener('change', evaluate);
    } else if (narrowQuery.addListener) {
        narrowQuery.addListener(evaluate);
    }

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            fullscreenRequested = false;
            if (isActive) {
                scheduleFullscreen();
            }
        }
    });

    ['pointerdown', 'touchstart', 'mousedown'].forEach(eventType => {
        document.addEventListener(eventType, handleGesture, { passive: true });
    });
}

export { initLandscapeLayout };
