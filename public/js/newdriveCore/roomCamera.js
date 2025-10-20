import { socket } from '../modules/socketGlobal.js';

const cameraElements = Array.from(document.querySelectorAll('[data-room-camera]'));
const blinkerElements = Array.from(document.querySelectorAll('[data-room-camera-blinker]'));

let roomCameraUrl = null;

socket.on('room-camera-frame', (data) => {
  if (!cameraElements.length) {
    return;
  }

  const blob = new Blob([data], { type: 'image/lpeg' });
  if (roomCameraUrl) {
    URL.revokeObjectURL(roomCameraUrl);
  }
  roomCameraUrl = URL.createObjectURL(blob);

  cameraElements.forEach((img) => {
    img.src = roomCameraUrl;
  });

  blinkerElements.forEach((indicator) => {
    indicator.classList.toggle('bg-red-500');
    indicator.classList.toggle('bg-green-500');
  });
});
