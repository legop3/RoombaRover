console.log('Newdrive JS loaded');

import './modules/features.js';
import './modules/uiState.js';
import './modules/uiConfig.js';
import './modules/hudAndSensors.js';
import './modules/adminLogin.js';
import './modules/homeAssistantLights.js';
import './modules/iframeAutomation.js';
import './modules/roomCamera.js';
import './modules/adminControls.js';
import './modules/mediaControls.js';
import './modules/driverControls.js';
import './modules/nicknames.js';
import './modules/turns.js';
import './modules/chatSend.js';
import './modules/chatGet.js';
import './modules/logs.js';
import './modules/notifications.js';
import './modules/presence.js';
import './modules/ollama.js';
import './modules/connection.js';
import './modules/webcam.js';
import './modules/maintenance.js';

const TAB_STORAGE_KEY = 'newdrive:active-tab';
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = new Map(
    Array.from(document.querySelectorAll('[data-tab-panel]')).map(panel => [panel.dataset.tabPanel, panel])
);

function setActiveTab(name) {
    if (!name || !tabPanels.size) return;
    const activeName = tabPanels.has(name) ? name : tabPanels.keys().next().value;
    tabButtons.forEach(button => {
        const isActive = button.dataset.tab === activeName;
        button.setAttribute('aria-selected', String(isActive));
        button.classList.toggle('bg-blue-500', isActive);
        button.classList.toggle('bg-gray-700', !isActive);
    });
    tabPanels.forEach((panel, key) => {
        panel.classList.toggle('hidden', key !== activeName);
    });
    try {
        localStorage.setItem(TAB_STORAGE_KEY, activeName);
    } catch (error) {
        console.debug('Unable to persist tab selection', error);
    }
}

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const target = button.dataset.tab;
        if (target) {
            setActiveTab(target);
        }
    });
});

try {
    const storedTab = localStorage.getItem(TAB_STORAGE_KEY);
    if (storedTab && tabPanels.has(storedTab)) {
        setActiveTab(storedTab);
    } else if (tabButtons.length) {
        setActiveTab(tabButtons[0].dataset.tab);
    }
} catch (error) {
    console.debug('Unable to read stored tab', error);
    if (tabButtons.length) {
        setActiveTab(tabButtons[0].dataset.tab);
    }
}

const layout = document.getElementById('newdrive-layout');
const stage = document.getElementById('mobile-landscape-stage');
const stageControls = document.getElementById('mobile-landscape-controls');
const stageJoystick = document.getElementById('mobile-landscape-joystick');
const leftPanel = document.querySelector('.left-panel');
const rightPanel = document.querySelector('.right-panel');

const controlsCard = document.getElementById('controls-card');
const controlsHome = document.getElementById('controls-card-home');
const turnQueueCard = document.getElementById('turn-queue-card');
const turnQueueHome = document.getElementById('turn-queue-card-home');
const joystickCard = document.getElementById('joystick-card');
const joystickHome = document.getElementById('joystick-card-home');

let landscapeStageMounted = false;
let fullscreenPending = false;
let fullscreenRequested = false;

function moveIntoStage() {
    if (!layout || !stage || !leftPanel) return;
    if (!landscapeStageMounted) {
        layout.insertBefore(stage, leftPanel);
        landscapeStageMounted = true;
    }
    stage.classList.remove('hidden');
    if (controlsCard && stageControls) {
        stageControls.appendChild(controlsCard);
        if (turnQueueCard) {
            stageControls.appendChild(turnQueueCard);
        }
    }
    if (joystickCard && stageJoystick) {
        stageJoystick.appendChild(joystickCard);
    }
    if (rightPanel) {
        rightPanel.classList.add('mobile-only-hidden');
    }
}

function moveOutOfStage() {
    if (stage) {
        stage.classList.add('hidden');
    }
    if (controlsCard && controlsHome) {
        controlsHome.appendChild(controlsCard);
    }
    if (turnQueueCard && turnQueueHome) {
        turnQueueHome.appendChild(turnQueueCard);
    }
    if (joystickCard && joystickHome) {
        joystickHome.appendChild(joystickCard);
    }
    if (rightPanel) {
        rightPanel.classList.remove('mobile-only-hidden');
    }
}

function isTouchDevice() {
    return (
        ('ontouchstart' in window) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
        window.matchMedia('(pointer: coarse)').matches
    );
}

const narrowQuery = window.matchMedia('(max-width: 1024px)');
const landscapeQuery = window.matchMedia('(orientation: landscape)');

function shouldUseMobileLandscape() {
    return isTouchDevice() && narrowQuery.matches && landscapeQuery.matches;
}

function requestFullscreen() {
    if (document.fullscreenElement || fullscreenRequested) {
        fullscreenPending = false;
        return;
    }

    const el = document.documentElement;
    if (!el || typeof el.requestFullscreen !== 'function') {
        fullscreenPending = false;
        return;
    }

    el.requestFullscreen().then(() => {
        fullscreenRequested = true;
        fullscreenPending = false;
    }).catch(err => {
        console.debug('Fullscreen request rejected', err);
        fullscreenPending = false;
    });
}

function scheduleFullscreenRequest() {
    if (!shouldUseMobileLandscape()) return;
    if (document.fullscreenElement) return;
    fullscreenPending = true;
}

function handleGestureForFullscreen() {
    if (!fullscreenPending) return;
    requestFullscreen();
}

function enterMobileLandscape() {
    if (document.body.classList.contains('mobile-landscape-active')) return;
    document.body.classList.add('mobile-landscape-active');
    moveIntoStage();
    scheduleFullscreenRequest();
}

function exitMobileLandscape() {
    if (!document.body.classList.contains('mobile-landscape-active')) return;
    document.body.classList.remove('mobile-landscape-active');
    moveOutOfStage();
    fullscreenPending = false;
}

function evaluateLayout() {
    if (shouldUseMobileLandscape()) {
        enterMobileLandscape();
    } else {
        exitMobileLandscape();
    }
}

if (stage && layout && leftPanel) {
    evaluateLayout();
    window.addEventListener('resize', evaluateLayout);
    window.addEventListener('orientationchange', evaluateLayout);
    if (landscapeQuery.addEventListener) {
        landscapeQuery.addEventListener('change', evaluateLayout);
    } else if (landscapeQuery.addListener) {
        landscapeQuery.addListener(evaluateLayout);
    }
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        fullscreenRequested = false;
        if (document.body.classList.contains('mobile-landscape-active')) {
            scheduleFullscreenRequest();
        }
    }
});

['pointerdown', 'touchstart', 'mousedown'].forEach(eventType => {
    document.addEventListener(eventType, handleGestureForFullscreen, { passive: true });
});
