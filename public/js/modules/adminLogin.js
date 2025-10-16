import { socket, clientKey } from './socketGlobal.js';
import { showToast } from './toaster.js';
import { featureEnabled } from './features.js';

console.log("auth module loaded");


// admin overlay stuff

let reloadSet = null;
let reloadTimerInterval = null;
const requireAdminLogin = featureEnabled('requireAdminLogin', true);

function reloadTimer() {
    window.location.reload();
}

function hideOverlayAndClearReloadTimer() {
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.classList.add('hidden');
    if (reloadTimerInterval) {
        clearInterval(reloadTimerInterval);
        reloadTimerInterval = null;
    }
}

socket.on('connect_error', (err) => {
    const message = err?.message || 'Connection error';
    showToast(message, 'error', false);
    console.log('connect_error', message)

    if(message === 'ADMIN_ENABLED') {
        if (!requireAdminLogin) return;
        console.log('showverlay')
        let loginOverlay = document.getElementById('overlay')

        loginOverlay.classList.remove('hidden');
        if (!reloadTimerInterval) {
            reloadTimerInterval = setInterval(reloadTimer, 60000);
        }
    }

    if(message === 'LOCKDOWN_ENABLED') {
        console.log('showverlay lockdown')
        let loginOverlay = document.getElementById('overlay')
        loginOverlay.classList.remove('hidden');
        document.getElementById('overlay-top-caption').innerText = 'Lockdown Privacy mode is enabled. Only the owner can log in. This page reloads automatically every minute.'
        if (!reloadTimerInterval) {
            reloadTimerInterval = setInterval(reloadTimer, 60000);
        }
    }
})


socket.on('disconnect-reason', (reason) => {
    if(reason === 'SWITCH_TO_ADMIN') {
        if (!requireAdminLogin) return;
        document.getElementById('overlay').classList.remove('hidden')
        if (!reloadTimerInterval) {
            reloadTimerInterval = setInterval(reloadTimer, 60000);
        }
    }

    if(reason === 'SWITCH_TO_TURNS') {
        // console.log('disconnect, switch to turns')
        showToast('Switching to Turns mode. Reloading page.')
        window.location.reload();
    }
    

    if(reason === 'SWITCH_TO_LOCKDOWN') {
        console.log('showverlay lockdown')
        let loginOverlay = document.getElementById('overlay')
        loginOverlay.classList.remove('hidden');
        document.getElementById('overlay-top-caption').innerText = 'Lockdown Privacy mode is enabled. Only the owner can log in. This page reloads automatically every minute.'
        if (!reloadTimerInterval) {
            reloadTimerInterval = setInterval(reloadTimer, 60000);
        }
    }
})

// admin options show / no show
socket.on('admin-login', data => {
    document.getElementById('advanced-controls').classList.remove('hidden');
    let adminSettings = document.getElementById('admin-settings').classList.remove('hidden'); 
});

socket.on('connect', () => {
    clearInterval(reloadSet);
    hideOverlayAndClearReloadTimer();
})

// admin login stuff:

const overlayForm = document.getElementById('password-form');
const overlayInput = document.getElementById('password-input');
const inlineForm = document.getElementById('inline-password-form');
const inlineInput = document.getElementById('inline-password-input');

function handleLogin(form, input) {
    if (!form || !input) return;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const password = input.value.trim();

        // console.log(`attempting login ${password}`);

        if (password) {
            socket.auth = { clientKey, token: password };
            socket.disconnect();
            socket.connect();

            if (form === overlayForm) {
                document.getElementById('overlay').classList.add('hidden');
            }
        }
    });
}

handleLogin(overlayForm, overlayInput);
handleLogin(inlineForm, inlineInput);

export { handleLogin }
