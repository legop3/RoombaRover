const { spawn } = require('child_process');

var latestFrontFrame = null;

class CameraStream {
    constructor(io, cameraId, devicePath, options = {}) {
        this.io = io;
        this.cameraId = cameraId;
        this.devicePath = devicePath;
        this.width = options.width || 320;
        this.height = options.height || 240;
        this.fps = options.fps || 30;
        this.quality = options.quality || 5;
        this.ffmpeg = null;
        this.streaming = false;
        this.latestFrame = null;
        this.clients = new Set();
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
            '-f', 'mjpeg',
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
                
                // Store latest frame for both streaming and getLatestFrontFrame
                this.latestFrame = frame;
                
                // Update global latest front frame if this is the front camera
                if (this.cameraId === 'frontCamera') {
                    latestFrontFrame = frame.toString('base64');
                }
                
                // Broadcast frame to all connected MJPEG clients
                this.broadcastFrame(frame);
            }
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
        });
    }

    // Add this to your CameraStream class to see what's happening
    broadcastFrame(frame) {
        // console.log(`Broadcasting to ${this.clients.size} clients`);
        const boundary = 'myboundary';
        const header = `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
        
        this.clients.forEach(res => {
            try {
                res.write(Buffer.from(header));
                res.write(frame);
                res.write(Buffer.from('\r\n'));
            } catch (e) {
                console.log('Client disconnected:', e.message);
                this.clients.delete(res);
            }
        });

        this.io.emit('videoFrame')
    }

    // addClient(res) {
    //     const boundary = 'myboundary';
    //     res.writeHead(200, {
    //         'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
    //         'Cache-Control': 'no-cache',
    //         'Connection': 'keep-alive',
    //         'Access-Control-Allow-Origin': '*'
    //     });
        
    //     this.clients.add(res);
        
    //     res.on('close', () => {
    //         this.clients.delete(res);
    //     });
        
    //     res.on('error', () => {
    //         this.clients.delete(res);
    //     });
    // }

    // Add this to see what's happening
    addClient(res) {
        console.log(`Adding client, total clients: ${this.clients.size + 1}`);
        
        const boundary = 'myboundary';
        res.writeHead(200, {
            'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        
        this.clients.add(res);
        
        res.on('close', () => {
            console.log(`Client disconnected, remaining: ${this.clients.size - 1}`);
            this.clients.delete(res);
        });
    }

    stop() {
        if (this.ffmpeg) {
            this.ffmpeg.kill('SIGTERM');
            this.ffmpeg = null;
        }
        this.streaming = false;
        this.latestFrame = null;
        
        // Close all client connections
        this.clients.forEach(res => {
            try {
                res.end();
            } catch (e) {
                // Client already closed
            }
        });
        this.clients.clear();
    }

    // Method to get latest frame as base64 (for compatibility with existing code)
    getLatestFrameBase64() {
        return this.latestFrame ? this.latestFrame.toString('base64') : null;
    }

    // Method to get latest frame as buffer
    getLatestFrameBuffer() {
        return this.latestFrame;
    }
}

module.exports = {
    CameraStream,
    getLatestFrontFrame: () => latestFrontFrame,
}