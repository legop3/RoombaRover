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