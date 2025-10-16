import { socket } from './socketGlobal.js';
import { dom } from './dom.js';

console.log('chatGet module loaded');

const MAX_CHAT_MESSAGES = 20;

function appendChatMessage(payload) {
    if (!dom.chatMessagesCard || !dom.chatMessagesList) return;

    let messageText = '';
    let nicknameLabel = '';
    let timestamp = Date.now();
    let isSystem = false;

    if (typeof payload === 'string') {
        messageText = payload.trim();
    } else if (payload && typeof payload === 'object') {
        if (typeof payload.message === 'string') {
            messageText = payload.message.trim();
        }
        if (typeof payload.nickname === 'string') {
            nicknameLabel = payload.nickname.trim();
        }
        if (typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)) {
            timestamp = payload.timestamp;
        }
        isSystem = Boolean(payload.system);
    } else {
        return;
    }

    if (!messageText) return;

    dom.chatMessagesCard.classList.remove('hidden');

    const item = document.createElement('div');
    item.className = 'bg-gray-700 rounded-xl p-2 break-words';
    if (isSystem) {
        item.classList.add('border', 'border-purple-400');
    }

    const displayTime = new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const label = nicknameLabel || (isSystem ? 'System' : '');
    const prefix = label ? `${label}: ` : '';
    item.textContent = `[${displayTime}] ${prefix}${messageText}`;

    dom.chatMessagesList.appendChild(item);

    while (dom.chatMessagesList.childElementCount > MAX_CHAT_MESSAGES) {
        dom.chatMessagesList.removeChild(dom.chatMessagesList.firstChild);
    }

    dom.chatMessagesList.scrollTop = dom.chatMessagesList.scrollHeight;
}

socket.on('userMessageRe', message => {
    appendChatMessage(message);
});
