const socket = io();

function sendDriveCommand(command) {
    socket.emit('drive', { command });
}

document.addEventListener('keydown', (event) => {
    switch (event.key) {
        case 'w': sendDriveCommand('forward'); break;
        case 'a': sendDriveCommand('left'); break;
        case 's': sendDriveCommand('backward'); break;
        case 'd': sendDriveCommand('right'); break;
    }
});

document.addEventListener('keyup', (event) => {
    if (['w', 'a', 's', 'd'].includes(event.key)) {
        sendDriveCommand('stop');
    }
});

socket.on('sensorData', (data) => {
    document.getElementById('data-output').innerText = JSON.stringify(data, null, 2);
});