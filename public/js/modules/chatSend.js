import { socket } from './socketGlobal.js'
import { featureEnabled } from './features.js';

console.log('chatSend module loaded')

const inputEl = document.getElementById('messageInput');
const sendButton = document.getElementById('sendMessageButton');
const beepCheckbox = document.getElementById('beepcheck');
const canSendChat = featureEnabled('allowChatSend', true);

if (!canSendChat) {
    if (inputEl) {
        inputEl.setAttribute('disabled', 'true');
        inputEl.placeholder = 'Chat disabled for spectators.';
    }
    if (sendButton) {
        sendButton.setAttribute('disabled', 'true');
        sendButton.classList.add('opacity-60', 'cursor-not-allowed');
    }
    if (beepCheckbox) {
        beepCheckbox.setAttribute('disabled', 'true');
    }
} else {
    if (inputEl) {
        inputEl.addEventListener('input', () => {
            const message = inputEl.value;
            socket.emit('userTyping', { message, beep: Boolean(beepCheckbox?.checked) });
        });
    }

    if (sendButton && inputEl) {
        sendButton.addEventListener('click', () => {
            const message = inputEl.value.trim();
            if (!message) {
                inputEl.value = '';
                return;
            }

            socket.emit('userMessage', { message, beep: Boolean(beepCheckbox?.checked) });
            inputEl.value = '';
        });
    }
}
