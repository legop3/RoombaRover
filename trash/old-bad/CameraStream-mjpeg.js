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
        
        // Buffer management for smoother streaming
        this.frameQueue = [];
        this.maxQueueSize = 3; // Limit queue to prevent memory buildup
        this.isProcessingFrame = false;
    }

    start() {
        if (this.streaming) return;
        this.streaming = true;
        console.log(`Starting stream for camera ${this.cameraId}`);

        this.ffmpeg = spawn('ffmpeg', [
            '-f', 'v4l2',
            '-flags', 'low_delay',
            '-fflags', 'nobuffer+flush_packets',
            '-probesize', '32',
            '-analyzeduration', '0',
            '-i', this.devicePath,
            '-vf', `scale=${this.width}:${this.height}`,
            '-r', String(this.fps),
            '-q:v', String(this.quality),
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-an',
            '-f', 'mjpeg',
            '-flush_packets', '1',
            'pipe:1',
        ]);

        let frameBuffer = Buffer.alloc(0);
        this.ffmpeg.stdout.on('data', (chunk) => {
            frameBuffer = Buffer.concat([frameBuffer, chunk]);
            
            // Process all complete frames in the buffer
            this.processFrameBuffer(frameBuffer);
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

    processFrameBuffer(frameBuffer) {
        let start, end;
        while ((start = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]))) !== -1 &&
               (end = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start)) !== -1) {
            
            const frame = frameBuffer.slice(start, end + 2);
            frameBuffer = frameBuffer.slice(end + 2);
            
            // Add frame to queue instead of processing immediately
            this.addFrameToQueue(frame);
        }
        
        // Process frames from queue
        this.processFrameQueue();
        
        return frameBuffer;
    }

    addFrameToQueue(frame) {
        // Keep only the latest frames to prevent lag
        if (this.frameQueue.length >= this.maxQueueSize) {
            this.frameQueue.shift(); // Remove oldest frame
        }
        this.frameQueue.push(frame);
    }

    processFrameQueue() {
        if (this.isProcessingFrame || this.frameQueue.length === 0) {
            return;
        }

        this.isProcessingFrame = true;
        
        // Process the latest frame
        const frame = this.frameQueue.pop();
        this.frameQueue = []; // Clear queue to prevent lag
        
        // Store latest frame for both streaming and getLatestFrontFrame
        this.latestFrame = frame;
        
        // Update global latest front frame if this is the front camera
        if (this.cameraId === 'frontCamera') {
            latestFrontFrame = frame.toString('base64');
        }
        
        // Broadcast frame to all connected MJPEG clients
        this.broadcastFrame(frame);
        
        this.isProcessingFrame = false;
    }

    broadcastFrame(frame) {
        if (this.clients.size === 0) return;
        
        const boundary = 'myboundary';
        const header = `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
        const headerBuffer = Buffer.from(header);
        const endBuffer = Buffer.from('\r\n');
        
        // Pre-allocate the complete frame buffer
        const completeFrame = Buffer.concat([headerBuffer, frame, endBuffer]);
        
        // Use async writes to prevent blocking
        this.clients.forEach(res => {
            setImmediate(() => {
                try {
                    if (!res.destroyed && res.writable) {
                        res.write(completeFrame);
                    } else {
                        this.clients.delete(res);
                    }
                } catch (e) {
                    console.log('Client disconnected:', e.message);
                    this.clients.delete(res);
                }
            });
        });
    }

    addClient(res) {
        console.log(`Adding client, total clients: ${this.clients.size + 1}`);
        
        const boundary = 'myboundary';
        res.writeHead(200, {
            'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no' // Disable nginx buffering if behind proxy
        });
        
        // Set socket options for better performance
        if (res.socket) {
            res.socket.setNoDelay(true);
            res.socket.setKeepAlive(true, 1000);
        }
        
        this.clients.add(res);
        
        res.on('close', () => {
            console.log(`Client disconnected, remaining: ${this.clients.size - 1}`);
            this.clients.delete(res);
        });
        
        res.on('error', (err) => {
            console.log('Client error:', err.message);
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
        this.frameQueue = [];
        
        // Close all client connections
        this.clients.forEach(res => {
            try {
                if (!res.destroyed) {
                    res.end();
                }
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
};