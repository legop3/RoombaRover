import { socket } from './socketGlobal.js';

console.log("adminControls module loaded");

const accessModeSelect = document.getElementById('access-mode-select');

if (accessModeSelect) {
    socket.on('mode-update', data => {
        console.log('mode update', data);
        accessModeSelect.value = data;
    });

    accessModeSelect.addEventListener('change', () => {
        console.log('mode change');
        socket.emit('change-access-mode', accessModeSelect.value);
    });
}

function startAV() {
    socket.emit('av:start');
}
window.startAV = startAV;

function stopAV() {
    socket.emit('av:stop');
}
window.stopAV = stopAV;

function dockNow() {
    socket.emit('Docking', { action: 'dock' });
}
window.dockNow = dockNow;

function reconnectRoomba() {
    socket.emit('Docking', { action: 'reconnect' });
}
window.reconnectRoomba = reconnectRoomba;

function sensorData() {
    // socket.emit('requestSensorData');
    socket.emit('sensor:reset');
}
window.sensorData = sensorData;

function sideBrush(state) {
    socket.emit('sideBrush', { action: state });
}
window.sideBrush = sideBrush;

export {
    startAV,
    stopAV,
    dockNow,
    reconnectRoomba,
    sensorData,
    sideBrush
};
