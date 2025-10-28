import { socket } from './socketGlobal.js'
import { featureEnabled } from './features.js';
import { setCookie, readCookie } from './uiState.js';

console.log('chatSend module loaded')

const inputEl = document.getElementById('messageInput');
const sendButton = document.getElementById('sendMessageButton');
const beepCheckbox = document.getElementById('beepcheck');
const voiceSelect = document.getElementById('voiceSelect');
const VOICE_COOKIE_NAME = 'ttsVoice';
const DEFAULT_VOICE = 'slt';

let currentVoice = readCookie(VOICE_COOKIE_NAME) || DEFAULT_VOICE;

function persistVoice(value) {
    const trimmed = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_VOICE;
    currentVoice = trimmed;
    setCookie(VOICE_COOKIE_NAME, currentVoice);
    if (voiceSelect) {
        voiceSelect.value = currentVoice;
    }
}

persistVoice(currentVoice);

if (voiceSelect) {
    voiceSelect.addEventListener('change', () => {
        persistVoice(voiceSelect.value);
    });
}

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

            const voice = voiceSelect?.value || currentVoice || DEFAULT_VOICE;
            persistVoice(voice);
            socket.emit('userMessage', { message, beep: Boolean(beepCheckbox?.checked), voice });
            inputEl.value = '';
        });
    }
}
