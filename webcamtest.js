const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');

const app = express();
const server = app.listen(3000, () => console.log('Server running on http://localhost:3000'));
const wss = new WebSocket.Server({ server });

let ffmpeg = null;
let clients = new Set();

function startFFmpeg() {
  if (ffmpeg) return;
  ffmpeg = spawn('ffmpeg', [
    '-f', 'v4l2',
    '-input_format', 'mjpeg',
    '-i', '/dev/video0',
    '-vf', 'scale=640:480',
    '-r', '20',
    '-q:v', '10',
    '-f', 'mjpeg',
    'pipe:1'
  ]);

  ffmpeg.stdout.on('data', (chunk) => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    // Uncomment for debugging:
    // console.error(`ffmpeg stderr: ${data}`);
  });

  ffmpeg.on('error', (err) => {
    console.error('Failed to start ffmpeg:', err);
    stopFFmpeg();
  });

  ffmpeg.on('close', () => {
    ffmpeg = null;
  });
}

function stopFFmpeg() {
  if (ffmpeg) {
    ffmpeg.kill('SIGINT');
    ffmpeg = null;
  }
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <img id="video" width="640" height="480" />
        <script>
          const img = document.getElementById('video');
          const ws = new WebSocket('ws://' + location.host);
          ws.binaryType = 'arraybuffer';
          ws.onmessage = (event) => {
            const blob = new Blob([event.data], { type: 'image/jpeg' });
            img.src = URL.createObjectURL(blob);
          };
        </script>
      </body>
    </html>
  `);
});

wss.on('connection', (ws) => {
  clients.add(ws);
  startFFmpeg();

  ws.on('close', () => {
    clients.delete(ws);
    if (clients.size === 0) {
      stopFFmpeg();
    }
  });
});