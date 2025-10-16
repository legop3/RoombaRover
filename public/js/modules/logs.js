import { socket } from './socketGlobal.js';
import { dom } from './dom.js';

console.log('logs module loaded');

const logContainer = document.getElementById('log-container');

socket.on('logs', logs => {
    if (!logContainer) return;
    logContainer.innerHTML = '';
    if (!Array.isArray(logs) || logs.length === 0) {
        logContainer.innerHTML = '<p class="text-xs">No logs available.</p>';
        return;
    }
    logs.forEach(log => {
        const logItem = document.createElement('p');
        logItem.className = 'text-xs font-mono';
        logItem.innerText = log;
        logContainer.appendChild(logItem);
    });
    logContainer.scrollTop = logContainer.scrollHeight;
});

if (dom.requestLogsButton) {
    dom.requestLogsButton.addEventListener('click', () => {
        socket.emit('requestLogs');
    });
}

if (dom.resetLogsButton && logContainer) {
    dom.resetLogsButton.addEventListener('click', () => {
        socket.emit('resetLogs');
        logContainer.innerHTML = '<p class="text-sm text-gray-300">Logs cleared.</p>';
    });
}
