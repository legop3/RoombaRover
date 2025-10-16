import { socket } from './socketGlobal.js';
import { dom } from './dom.js';
import { showToast } from './toaster.js';

console.log('notifications module loaded');

socket.on('message', data => {
    if (dom.message) {
        dom.message.innerText = data;
    }
    showToast(data, 'info');
});

socket.on('alert', data => {
    if (dom.message) {
        dom.message.innerText = data;
    }
    showToast(data, 'error', false);
});

socket.on('warning', data => {
    showToast(data, 'warning', false);
});

socket.on('ffmpeg', data => {
    if (dom.ffmpeg) {
        dom.ffmpeg.innerText = data;
    }
});
