const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('Client connected');
});

// 20ms period at 16kHz, 1 channel, 16-bit: 16,000 * 2 * 1 * 0.02 = 640 bytes
const arecord = spawn('arecord', [
  '-f', 'S16_LE',
  '-r', '16000',
  '-c', '1',
  '--buffer-time=20000', // buffer time in microseconds (20ms)
  '--period-time=20000'  // period time in microseconds (20ms)
]);

arecord.stdout.on('data', (data) => {
  io.emit('audio', data.toString('base64'));
});

arecord.stderr.on('data', (data) => {
  console.error(`arecord error: ${data}`);
});

arecord.on('close', (code) => {
  console.log(`arecord process exited with code ${code}`);
});

server.listen(3000, () => {
  console.log('Server listening on http://localhost:3000');
});