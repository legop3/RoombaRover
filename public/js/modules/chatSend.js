import { socket } from './socketGlobal.js'

console.log('chatSend module loaded')

document.getElementById('messageInput').addEventListener('input', () => {
    const message = document.getElementById('messageInput').value
    socket.emit('userTyping', { message, beep: document.getElementById('beepcheck').checked });
});


document.getElementById('sendMessageButton').addEventListener('click', () => {
    const inputEl = document.getElementById('messageInput');
    if (!inputEl) return;
    const message = inputEl.value.trim();
    if (!message) {
        inputEl.value = '';
        return;
    }

    socket.emit('userMessage', { message, beep: document.getElementById('beepcheck').checked });
    inputEl.value = '';
});
