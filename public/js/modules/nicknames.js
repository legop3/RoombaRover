import { socket } from './socketGlobal.js';
import { dom } from './dom.js';

console.log("nicknames module loaded");


const MAX_CHAT_MESSAGES = 20;
const NICKNAME_STORAGE_KEY = 'roombarover:nickname';
let currentNickname = '';
let desiredNickname = localStorage.getItem(NICKNAME_STORAGE_KEY) || '';

if (dom.nicknameInput && desiredNickname) {
    dom.nicknameInput.value = desiredNickname;
}



// send a message to the roomba screen
if (dom.nicknameSaveButton) {
    dom.nicknameSaveButton.addEventListener('click', () => {
        if (!dom.nicknameInput) return;
        requestNicknameUpdate(dom.nicknameInput.value);
    });
}

if (dom.nicknameInput) {
    dom.nicknameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            requestNicknameUpdate(dom.nicknameInput.value);
        }
    });

    dom.nicknameInput.addEventListener('input', () => {
        setNicknameStatus('');
    });
}


function setNicknameStatus(message, type = 'info') {
    if (!dom.nicknameStatus) return;

    if (!message) {
        dom.nicknameStatus.textContent = '';
        dom.nicknameStatus.classList.add('hidden');
        dom.nicknameStatus.classList.remove('text-red-300', 'text-green-300', 'text-gray-200');
        return;
    }

    dom.nicknameStatus.classList.remove('hidden');
    dom.nicknameStatus.textContent = message;

    dom.nicknameStatus.classList.remove('text-red-300', 'text-green-300', 'text-gray-200');
    if (type === 'error') {
        dom.nicknameStatus.classList.add('text-red-300');
    } else if (type === 'success') {
        dom.nicknameStatus.classList.add('text-green-300');
    } else {
        dom.nicknameStatus.classList.add('text-gray-200');
    }
}

function requestNicknameUpdate(rawNickname) {
    const trimmed = typeof rawNickname === 'string' ? rawNickname.trim() : '';
    if (!trimmed) {
        setNicknameStatus('Nickname cannot be empty.', 'error');
        return;
    }

    if (trimmed.length > 24) {
        setNicknameStatus('Nickname must be 24 characters or fewer.', 'error');
        return;
    }

    if (trimmed === currentNickname) {
        setNicknameStatus('Nickname is already set.', 'info');
        return;
    }

    desiredNickname = trimmed;

    if (!socket.connected) {
        setNicknameStatus('Saving when connection restores...', 'info');
        return;
    }

    socket.emit('setNickname', trimmed);
    setNicknameStatus('Saving nickname...', 'info');
}

socket.on('connect', () => {
    if (desiredNickname) {
        requestNicknameUpdate(desiredNickname);
    }
})


socket.on('nickname:update', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { userId, nickname } = payload;

    if (userId !== socket.id) {
        return;
    }

    const sanitized = typeof nickname === 'string' ? nickname : '';
    const fallback = sanitized || 'User';
    const previousDesired = desiredNickname;
    const changedByServer = previousDesired && previousDesired !== sanitized;
    const defaultNickname = typeof userId === 'string' && userId.length >= 4 ? `User ${userId.slice(-4)}` : '';
    const isDefaultNickname = sanitized === defaultNickname;

    currentNickname = sanitized;
    desiredNickname = isDefaultNickname ? '' : sanitized;

    if (dom.nicknameInput) {
        dom.nicknameInput.value = sanitized;
    }

    if (isDefaultNickname || currentNickname.startsWith('User')) {
        localStorage.removeItem(NICKNAME_STORAGE_KEY);
    } else {
        localStorage.setItem(NICKNAME_STORAGE_KEY, sanitized);
    }

    if (!previousDesired && isDefaultNickname) {
        setNicknameStatus('');
        return;
    }

    const statusMessage = changedByServer
        ? `Nickname adjusted to ${fallback}.`
        : `Nickname set to ${fallback}.`;

    setNicknameStatus(statusMessage, 'success');
});