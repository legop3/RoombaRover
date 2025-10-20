import { socket } from './socketGlobal.js';
import { dom } from './dom.js';
import { featureEnabled } from './features.js';

console.log('connection module loaded');

const indicatorElements = (() => {
    const elements = new Set();
    if (dom.connectStatus) {
        elements.add(dom.connectStatus);
    }
    document.querySelectorAll('[data-connection-indicator]').forEach(el => elements.add(el));
    const fallback = document.getElementById('connectstatus');
    if (fallback) {
        elements.add(fallback);
    }
    return Array.from(elements);
})();

function updateConnectionIndicator(isConnected) {
    indicatorElements.forEach(el => {
        el.innerText = isConnected ? 'Connected' : 'Disconnected';
        el.classList.toggle('bg-green-500', isConnected);
        el.classList.toggle('bg-red-500', !isConnected);
    });
}

socket.on('connect', () => {
    updateConnectionIndicator(true);
    if (featureEnabled('requestSensorDataOnConnect', true)) {
        socket.emit('requestSensorData');
    }
    if (featureEnabled('autoStartAvOnConnect', true)) {
        socket.emit('startVideo');
        socket.emit('stopAudio');
        socket.emit('startAudio');
    }
});

socket.on('disconnect', () => {
    updateConnectionIndicator(false);
});

export { updateConnectionIndicator };
