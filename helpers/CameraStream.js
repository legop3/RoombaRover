// cameraStream.js
const { spawn } = require('child_process');
const { createLogger } = require('./logger');
const WebSocket = require('ws');

const logger = createLogger('CameraStream');

let latestFrontFrame = null;

// Per-client sender that guarantees: never queue more than 1 frame.
// If a new frame arrives while a send is in-flight, we overwrite the pending frame.
class RealtimeClient {
  constructor(ws, logger) {
    this.ws = ws;
    this.logger = logger;
    this.latest = null;   // Buffer | null
    this.sending = false;

    // Be explicit: avoid Nagle (usually already off for WS, but this ensures it)
    if (this.ws._socket && this.ws._socket.setNoDelay) {
      try { this.ws._socket.setNoDelay(true); } catch {}
    }
  }

  setFrame(buf) {
    // Keep only the most recent frame
    this.latest = buf;
    if (!this.sending) this._pump();
  }

  _pump() {
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.sending = false;
      this.latest = null;
      return;
    }
    if (!this.latest) {
      this.sending = false;
      return;
    }

    this.sending = true;
    const toSend = this.latest;
    this.latest = null;

    // Provide a callback so we only send the next frame once this write is flushed
    this.ws.send(toSend, { binary: true }, (err) => {
      if (err) {
        this.logger.error(`WS send error: ${err.message}`);
        this.sending = false;
        return;
      }
      // Immediately try to send whatever is newest now
      this._pump();
    });
  }
}

class CameraStream {
  constructor(io, cameraId, devicePath, wss, options = {}) {
    this.io = io;
    this.cameraId = cameraId;
    this.devicePath = devicePath;
    this.wss = wss;

    this.width = options.width || 320;
    this.height = options.height || 240;
    this.fps = options.fps || 30;
    this.quality = options.quality || 5; // from original; not used when copying MJPEG

    this.ffmpeg = null;
    this.streaming = false;

    // Track websocket -> RealtimeClient
    this.clients = new Map();
  }

  start() {
    if (this.streaming) return;
    this.streaming = true;
    logger.info(`Starting stream for camera ${this.cameraId}`);

    // NOTE: You are pulling MJPEG from v4l2 and piping JPEG frames out with minimal buffering.
    this.ffmpeg = spawn('ffmpeg', [
      '-f', 'v4l2',
      '-input_format', 'mjpeg',
      '-flags', 'low_delay',
      '-fflags', 'nobuffer',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-framerate', String(this.fps),
      '-video_size', `${this.width}x${this.height}`,
      '-i', this.devicePath,
      '-c:v', 'copy',
      '-f', 'image2pipe',
      '-flush_packets', '1',         // push bytes ASAP
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let frameBuffer = Buffer.alloc(0);
    const SOI = Buffer.from([0xFF, 0xD8]); // Start of Image
    const EOI = Buffer.from([0xFF, 0xD9]); // End of Image

    this.ffmpeg.stdout.on('data', (chunk) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);

      let start, end;
      // Extract complete JPEGs and broadcast immediately
      while ((start = frameBuffer.indexOf(SOI)) !== -1 &&
             (end = frameBuffer.indexOf(EOI, start)) !== -1) {
        const frame = frameBuffer.slice(start, end + 2);
        frameBuffer = frameBuffer.slice(end + 2);

        // Store latest for snapshots
        latestFrontFrame = frame;

        // Broadcast "latest-only" to each client (no queue growth)
        this.broadcastFrame(frame);
      }
    });

    this.ffmpeg.stderr.on('data', (data) => {
      // Optional: reduce log volume if too chatty
      this.io.emit(`ffmpeg`, data.toString());
    });

    this.ffmpeg.on('close', (code, signal) => {
      this.stop();
      logger.info(`FFmpeg process closed for camera ${this.cameraId} (code=${code}, signal=${signal})`);
      this.io.emit(`message`, `Video stream stopped`);
    });
  }

  broadcastFrame(frame) {
    // Push the newest frame into each client's pump
    for (const [ws, rtc] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      rtc.setFrame(frame);
    }
  }

  addClient(ws) {
    const rtc = new RealtimeClient(ws, logger);
    this.clients.set(ws, rtc);
    logger.info(`Client connected, total clients: ${this.clients.size}`);

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.info(`Client disconnected, total clients: ${this.clients.size}`);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`);
    });
  }

  stop() {
    if (this.ffmpeg) {
      try { this.ffmpeg.kill('SIGTERM'); } catch {}
      this.ffmpeg = null;
    }
    this.streaming = false;

    // Close all WebSocket connections
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.close(); } catch {}
      }
    }
    this.clients.clear();
  }
}

module.exports = {
  CameraStream,
  getLatestFrontFrame: () => (latestFrontFrame ? latestFrontFrame.toString('base64') : null),
};
