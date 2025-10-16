import { socket } from './socketGlobal.js';

console.log("driverControls module loaded");

const accessModeSelect = document.getElementById('access-mode-select');

socket.on('mode-update', data => {

    // if(data === 'admin') {
    // adminSettings = document.getElementById('admin-settings').classList.remove('hidden');
    console.log('mode update', data);
    accessModeSelect.value = data;
    // }

});
accessModeSelect.addEventListener('change', (event) =>{
    console.log('mode change')
    socket.emit('change-access-mode', accessModeSelect.value)
})


function startAV() { socket.emit('av:start'); };
window.startAV = startAV;

function stopAV() { socket.emit('av:stop'); };
window.stopAV = stopAV;

function dockNow() { socket.emit('Docking', { action: 'dock' }); }
window.dockNow = dockNow;

function reconnectRoomba() { socket.emit('Docking', { action: 'reconnect' }); }
window.reconnectRoomba = reconnectRoomba;

function sensorData() { socket.emit('requestSensorData'); }
window.sensorData = sensorData;