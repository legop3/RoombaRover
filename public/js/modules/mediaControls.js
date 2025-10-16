import { socket } from './socketGlobal.js';

console.log('mediaControls module loaded');

function startVideo() {
    socket.emit('startVideo');
}
window.startVideo = startVideo;

function stopVideo() {
    socket.emit('stopVideo');
}
window.stopVideo = stopVideo;

function startAudio() {
    socket.emit('startAudio');
}
window.startAudio = startAudio;

function stopAudio() {
    socket.emit('stopAudio');
}
window.stopAudio = stopAudio;

export {
    startVideo,
    stopVideo,
    startAudio,
    stopAudio
};
