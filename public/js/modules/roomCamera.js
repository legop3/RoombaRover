import { socket } from './socketGlobal.js';

console.log("roomCamera module loaded");

let roomCameraUrl = null;

let roomBlinker = document.getElementById('room-blinker')
socket.on('room-camera-frame', data => {
    const blob = new Blob([data], {type: 'image/lpeg'});
    if(roomCameraUrl) URL.revokeObjectURL(roomCameraUrl);
    roomCameraUrl = URL.createObjectURL(blob);
    document.getElementById('room-camera').src = roomCameraUrl;

    roomBlinker.classList.toggle('bg-red-500');
    roomBlinker.classList.toggle('bg-green-500');
    // console.log('room camera frame')
})