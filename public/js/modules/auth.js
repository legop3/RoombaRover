import { socket } from './socketGlobal.js';

console.log("auth module loaded");

const overlayForm = document.getElementById('password-form');
const overlayInput = document.getElementById('password-input');
const inlineForm = document.getElementById('inline-password-form');
const inlineInput = document.getElementById('inline-password-input');

function handleLogin(form, input) {
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const password = input.value.trim();

        console.log(`attempting login ${password}`);

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