import { socket } from './socketGlobal.js';

console.log('webcam module loaded');

let webcamInterval = null;
let currentStream = null;

function stopExistingInterval() {
    if (webcamInterval) {
        clearInterval(webcamInterval);
        webcamInterval = null;
    }
}

function stopExistingStream() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
}

async function startWebcam() {
    const videoEl = document.getElementById('localcam');
    if (!videoEl) {
        console.warn('No localcam element found for webcam streaming.');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });
        stopExistingStream();
        currentStream = stream;
        videoEl.srcObject = stream;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        stopExistingInterval();
        webcamInterval = setInterval(() => {
            if (!videoEl.videoWidth || !videoEl.videoHeight) return;
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL('image/jpeg', 0.5);
            socket.emit('userWebcam', data);
        }, 500);
    } catch (error) {
        console.warn('Unable to start webcam:', error);
    }
}

function stopWebcam() {
    stopExistingInterval();
    stopExistingStream();
    const videoEl = document.getElementById('localcam');
    if (videoEl) {
        videoEl.srcObject = null;
    }
}

window.startWebcam = startWebcam;
window.stopWebcam = stopWebcam;

export { startWebcam, stopWebcam };
