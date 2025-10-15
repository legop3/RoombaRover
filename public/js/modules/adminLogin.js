import { socket } from './socketGlobal.js';

console.log("auth module loaded");


// admin overlay stuff

let reloadSet = null;
let reloadTimerInterval = null;

function reloadTimer() {
    window.location.reload();
}

socket.on('connect_error', (err) => {
    showToast(err, 'error', false)
    console.log('connect_error', err.message)

    if(err.message === 'ADMIN_ENABLED') {
        console.log('showverlay')
        let loginOverlay = document.getElementById('overlay')

        loginOverlay.classList.remove('hidden');
        if (!reloadTimerInterval) {
            reloadTimerInterval = setInterval(reloadTimer, 60000);
        }
    }

    if(err.message === 'LOCKDOWN_ENABLED') {
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
    
})

// client key stuff:
const CLIENT_KEY_STORAGE_KEY = 'roombarover:client-key';

function generateClientKey() {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateClientKey() {
    try {
        let key = localStorage.getItem(CLIENT_KEY_STORAGE_KEY);
        if (typeof key === 'string' && key.trim()) {
            return key.trim();
        }
        key = generateClientKey();
        localStorage.setItem(CLIENT_KEY_STORAGE_KEY, key);
        return key;
    } catch (error) {
        console.warn('client key storage unavailable', error);
        return generateClientKey();
    }
}

const clientKey = getOrCreateClientKey();

// admin login stuff:

const overlayForm = document.getElementById('password-form');
const overlayInput = document.getElementById('password-input');
const inlineForm = document.getElementById('inline-password-form');
const inlineInput = document.getElementById('inline-password-input');

function handleLogin(form, input) {
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