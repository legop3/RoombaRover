const { spawn } = require('child_process');

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
        this.interval = 1000 / this.fps;
        this.ffmpeg = null;
        this.streaming = false;
        this.latestFrame = null;
        this.sendFrameInterval = null;
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
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            'pipe:1',
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
                this.io.emit(`videoFrame:${this.cameraId}`, frameToSend.toString('base64'));
                if (this.cameraId === 'frontCamera') {
                    latestFrontFrame = frameToSend.toString('base64');
                }
            }
        }, this.interval);

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
        this.latestFrame = null;

        if (this.sendFrameInterval) {
            clearInterval(this.sendFrameInterval);
            this.sendFrameInterval = null;
        }
    }
}

module.exports = {
    CameraStream,
    getLatestFrontFrame: () => latestFrontFrame,
}
