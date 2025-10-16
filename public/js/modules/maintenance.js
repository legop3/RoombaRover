import { socket } from './socketGlobal.js';

console.log('maintenance module loaded');

function rebootServer() {
    const confirmCheckbox = document.getElementById('rebootconfirm');
    if (!confirmCheckbox) {
        alert('Reboot confirmation not available.');
        return;
    }

    if (confirmCheckbox.checked) {
        socket.emit('rebootServer');
        confirmCheckbox.checked = false;
        alert("Rebooting Roomba's server. This will take a few minutes.");
    } else {
        alert('Please check the confirmation box to reboot the server.');
    }
}

window.rebootServer = rebootServer;

export { rebootServer };
