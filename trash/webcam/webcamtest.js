const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const wrtc = require('wrtc');
const { spawn } = require('child_process');
const SimplePeer = require('simple-peer');

// Create HTTP server to serve index.html
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    const file = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(file);
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  console.log('Client connected');

  const peer = new SimplePeer({ initiator: true, wrtc });

  peer.on('signal', data => {
    socket.send(JSON.stringify({ type: 'signal', data }));
  });

  socket.on('message', message => {
    const { type, data } = JSON.parse(message);
    if (type === 'signal') {
      peer.signal(data);
    }
  });

  peer.on('connect', () => {
    console.log('WebRTC connected! Streaming webcam and mic...');

    const ffmpeg = spawn('ffmpeg', [
      '-f', 'v4l2',
      '-i', '/dev/video0',
      '-f', 'alsa',
      '-i', 'default',
      '-f', 'mpegts',
      '-codec:v', 'mpeg1video',
      '-codec:a', 'mp2',
      '-'
    ]);

    ffmpeg.stdout.on('data', chunk => {
      peer.send(chunk);
    });

    ffmpeg.stderr.on('data', data => {
      console.error(data.toString());
    });

    peer.on('close', () => {
      ffmpeg.kill('SIGINT');
    });
  });

  peer.on('error', err => console.error('Peer error:', err));
});

// Start both HTTP and WebSocket servers on port 3000
server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
