import { socket } from './socketGlobal.js';
import { dom } from './dom.js';
import { featureEnabled } from './features.js';

console.log('connection module loaded');

const connectStatusEl = dom.connectStatus || document.getElementById('connectstatus');

function updateConnectionIndicator(isConnected) {
    if (!connectStatusEl) return;
    connectStatusEl.innerText = isConnected ? 'Connected' : 'Disconnected';
    connectStatusEl.classList.toggle('bg-green-500', isConnected);
    connectStatusEl.classList.toggle('bg-red-500', !isConnected);
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
