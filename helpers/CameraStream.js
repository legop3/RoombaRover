const { spawn } = require('child_process');
const { createLogger } = require('./logger');
const WebSocket = require('ws');

const logger = createLogger('CameraStream');

var latestFrontFrame = null;

class CameraStream {
    constructor(io, cameraId, devicePath, wss, options = {}) {
        this.io = io;
        this.cameraId = cameraId;
        this.devicePath = devicePath;
        this.wss = wss; // WebSocket server for video frames
        this.width = options.width || 640;
        this.height = options.height || 480;
        this.fps = options.fps || 15;
        this.quality = options.quality || 5;
        this.interval = 1000 / this.fps;
        this.ffmpeg = null;
        this.streaming = false;
        this.latestFrame = null;
        this.sendFrameInterval = null;
        this.clients = new Set(); // Track WebSocket clients
    }

    start() {
        if (this.streaming) return;
        this.streaming = true;
        logger.info(`Starting stream for camera ${this.cameraId}`);

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
            'pipe:1'
        ]);

        let frameBuffer = Buffer.alloc(0);

        this.ffmpeg.stdout.on('data', (chunk) => {
            frameBuffer = Buffer.concat([frameBuffer, chunk]);
            let start, end;
            while ((start = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]))) !== -1 &&
                   (end = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start)) !== -1) {
                const frame = frameBuffer.slice(start, end + 2);
                frameBuffer = frameBuffer.slice(end + 2);
                this.latestFrame = frame;
            }
        });

        this.sendFrameInterval = setInterval(() => {
            if (this.latestFrame) {
                const frameToSend = this.latestFrame;
                this.latestFrame = null;
                
                // Send to WebSocket clients
                this.broadcastFrame(frameToSend);
                
                // Store latest frame
                latestFrontFrame = frameToSend;
            }
        }, this.interval);

        this.ffmpeg.stderr.on('data', (data) => {
            // Still use Socket.IO for control/status messages
            this.io.emit(`ffmpeg`, data.toString());
        });

        this.ffmpeg.on('close', () => {
            this.stop();
            logger.info(`FFmpeg process closed for camera ${this.cameraId}`);
            // Still use Socket.IO for control messages
            this.io.emit(`message`, `Video stream stopped`);
        });
    }

    broadcastFrame(frame) {
        // Broadcast to all connected WebSocket clients
        // Skip clients with full buffers to prevent blocking
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.bufferedAmount === 0) {
                client.send(frame);
            }
        });
    }

    addClient(ws) {
        this.clients.add(ws);
        logger.info(`Client connected, total clients: ${this.clients.size}`);
        
        ws.on('close', () => {
            this.clients.delete(ws);
            logger.info(`Client disconnected, total clients: ${this.clients.size}`);
        });
    }

    stop() {
        if (this.ffmpeg) {
            this.ffmpeg.kill('SIGTERM');
            this.ffmpeg = null;
        }
        this.streaming = false;
        this.latestFrame = null;

        if (this.sendFrameInterval) {
            clearInterval(this.sendFrameInterval);
            this.sendFrameInterval = null;
        }

        // Close all WebSocket connections
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.close();
            }
        });
        this.clients.clear();
    }
}

module.exports = {
    CameraStream,
    getLatestFrontFrame: () => (latestFrontFrame ? latestFrontFrame.toString('base64') : null),
}