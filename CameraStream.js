const { spawn } = require('child_process');
const WebSocket = require('ws');

var latestFrontFrame = null;

class CameraStream {
    constructor(io, cameraId, devicePath, options = {}) {
        this.io = io;
        this.cameraId = cameraId;
        this.devicePath = devicePath;
        this.width = options.width || 320;
        this.height = options.height || 240;
        this.fps = options.fps || 15;
        this.quality = options.quality || 5;
        this.wsPort = options.wsPort || 9999;
        this.ffmpeg = null;
        this.streaming = false;
        this.wss = new WebSocket.Server({ port: this.wsPort });

        this.wss.on('connection', () => {
            console.log(`WebSocket client connected to ${this.cameraId} stream`);
        });
    }

    start() {
        if (this.streaming) return;
        this.streaming = true;
        console.log(`Starting stream for camera ${this.cameraId}`);

        this.ffmpeg = spawn('ffmpeg', [
            '-f', 'v4l2',
            '-flags', 'low_delay',
            '-fflags', 'nobuffer',
            '-i', this.devicePath,
            '-vf', `scale=${this.width}:${this.height}`,
            '-r', String(this.fps),
            '-q:v', String(this.quality),
            '-preset', 'ultrafast',
            '-an',
            '-vcodec', 'mpeg1video',
            '-f', 'mpegts',
            'pipe:1',
        ]);

        this.ffmpeg.stdout.on('data', (data) => {
            this.wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(data);
                }
            });
        });

        this.ffmpeg.stderr.on('data', (data) => {
            this.io.emit(`ffmpeg`, data.toString());
        });

        this.ffmpeg.on('close', () => {
            this.stop();
            console.log(`FFmpeg process closed for camera ${this.cameraId}`);
            this.io.emit(`message`, `Video stream stopped`);
        });

        this.ffmpeg.stderr.on('data', (data) => {
            // console.log(`${this.cameraId} FFMPEG error: ${data}`)
        })
    }

    stop() {
        if (this.ffmpeg) {
            this.ffmpeg.kill('SIGTERM');
            this.ffmpeg = null;
        }
        this.streaming = false;
    }
}

module.exports = {
    CameraStream,
    getLatestFrontFrame: () => latestFrontFrame,
}
