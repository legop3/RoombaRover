const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { driveDirect, stop } = require('./roomba');
const { readSensors } = require('./sensors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('drive', (data) => {
        switch (data.command) {
            case 'forward':
                driveDirect(200, 200);
                break;
            case 'backward':
                driveDirect(-200, -200);
                break;
            case 'left':
                driveDirect(-100, 100);
                break;
            case 'right':
                driveDirect(100, -100);
                break;
            case 'stop':
                stop();
                break;
        }
    });

    // Send sensor data every second
    const interval = setInterval(async () => {
        try {
            const sensorData = await readSensors();
            socket.emit('sensorData', sensorData);
        } catch (e) {
            // Ignore errors for now
        }
    }, 1000);

    socket.on('disconnect', () => {
        clearInterval(interval);
        console.log('A user disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});