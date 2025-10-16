import { socket } from './socketGlobal.js';


socket.on('logs', logs => {
    // console.log('Received logs:', logs);
    const logContainer = document.getElementById('log-container');
    logContainer.innerHTML = ''; // Clear previous logs
    if (logs.length === 0) {
        logContainer.innerHTML = '<p class="text-xs">No logs available.</p>';
    }
    logs.forEach(log => {
        const logItem = document.createElement('p');
        logItem.className = 'text-xs font-mono';
        logItem.innerText = log;
        logContainer.appendChild(logItem);
    });
    logContainer.scrollTop = logContainer.scrollHeight; // Scroll to bottom
})
