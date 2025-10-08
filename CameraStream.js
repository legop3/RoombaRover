const { spawn } = require('child_process');
const { createLogger } = require('./logger');

const logger = createLogger('CameraStream');

var latestFrontFrame = null;

class CameraStream {
    constructor(io, cameraId, devicePath, options = {}) {
        this.io = io;
        this.cameraId = cameraId;
        this.devicePath = devicePath;
        this.width = options.width || 640;
        this.height = options.height || 480;
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
        logger.info(`Starting stream for camera ${this.cameraId}`);

        // this.ffmpeg = spawn('ffmpeg', [
        //     '-f', 'v4l2',
        //     '-flags', 'low_delay',
        //     '-fflags', 'nobuffer',
        //     '-i', this.devicePath,
        //     '-vf', `scale=${this.width}:${this.height}`,
        //     '-r', String(this.fps),
        //     '-q:v', String(this.quality),
        //     '-preset', 'ultrafast',
        //     '-an',
        //     '-f', 'image2pipe',
        //     '-vcodec', 'mjpeg',
        //     'pipe:1',
        // ]);

        this.ffmpeg = spawn('ffmpeg', [
            '-f', 'v4l2',
            '-input_format', 'mjpeg',
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
                // Send raw JPEG buffer instead of base64 for efficiency
                this.io.emit(`videoFrame:${this.cameraId}`, frameToSend);
                if (this.cameraId === 'frontCamera') {
                    // Store latest frame as buffer for optional consumers
                    latestFrontFrame = frameToSend;
                }
            }
        }, this.interval);

        this.ffmpeg.stderr.on('data', (data) => {
            this.io.emit(`ffmpeg`, data.toString());
        });

        this.ffmpeg.on('close', () => {
            this.stop();
            logger.info(`FFmpeg process closed for camera ${this.cameraId}`);
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
    // Convert stored buffer to base64 on demand for compatibility
    getLatestFrontFrame: () => (latestFrontFrame ? latestFrontFrame.toString('base64') : null),
}
