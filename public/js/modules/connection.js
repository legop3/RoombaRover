import { socket, socketConfig } from './socketGlobal.js';
import { dom } from './dom.js';
import { sensorData } from './adminControls.js';
import { startVideo, startAudio, stopAudio } from './mediaControls.js';

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
    const shouldAutoStart = socketConfig.autoStartOnConnect !== false;
    if (shouldAutoStart) {
        try {
            sensorData();
            startVideo();
            stopAudio();
            startAudio();
        } catch (error) {
            console.warn('Failed to run connection startup handlers', error);
        }
    }
});

socket.on('disconnect', () => {
    updateConnectionIndicator(false);
});

export { updateConnectionIndicator };
