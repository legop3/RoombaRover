import { dom } from './dom.js';

console.log('uiState module loaded');

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

function setCookie(name, value) {
    document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}`;
}

function readCookie(name) {
    return document.cookie
        .split('; ')
        .find(row => row.startsWith(`${name}=`))
        ?.split('=')[1];
}

function applyInitialState(element, cookieName) {
    if (!element) return;
    const stored = readCookie(cookieName);
    if (typeof stored === 'undefined') return;
    const shouldHide = stored === 'true';
    element.classList.toggle('hidden', shouldHide);
}

if (dom.controlsGuideContainer && dom.hideControlsButton) {
    applyInitialState(dom.controlsGuideContainer, 'controlsGuideHidden');
    dom.hideControlsButton.addEventListener('click', () => {
        const nowHidden = dom.controlsGuideContainer.classList.toggle('hidden');
        setCookie('controlsGuideHidden', String(nowHidden));
    });
}

if (dom.roomControls && dom.hideRoomControlsButton) {
    applyInitialState(dom.roomControls, 'roomControlsHidden');
    dom.hideRoomControlsButton.addEventListener('click', () => {
        const nowHidden = dom.roomControls.classList.toggle('hidden');
        setCookie('roomControlsHidden', String(nowHidden));
    });
}

if (dom.ollamaAdvancedControls) {
    applyInitialState(dom.ollamaAdvancedControls, 'ollamaPanelHidden');
}

export { setCookie, readCookie };
