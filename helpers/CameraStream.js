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
        this.wss = wss;
        this.width = options.width || 320;
        this.height = options.height || 240;
        this.fps = options.fps || 30;
        this.quality = options.quality || 5;
        this.ffmpeg = null;
        this.streaming = false;
        this.clients = new Set();
        
        // Track frame stats per client for adaptive streaming
        this.clientStats = new WeakMap();
    }

    // start() {
    //     if (this.streaming) return;
    //     this.streaming = true;
    //     logger.info(`Starting stream for camera ${this.cameraId}`);

    //     this.ffmpeg = spawn('ffmpeg', [
    //         '-f', 'v4l2',
    //         '-input_format', 'mjpeg',
    //         '-flags', 'low_delay',
    //         '-fflags', 'nobuffer',
    //         '-probesize', '32',
    //         '-analyzeduration', '0',
    //         '-framerate', String(this.fps),
    //         '-video_size', `${this.width}x${this.height}`,
    //         '-i', this.devicePath,
    //         '-c:v', 'copy',
    //         '-f', 'image2pipe',
    //         '-flush_packets', '1',  // Force immediate output
    //         'pipe:1'
    //     ]);

    //     let frameBuffer = Buffer.alloc(0);

    //     this.ffmpeg.stdout.on('data', (chunk) => {
    //         frameBuffer = Buffer.concat([frameBuffer, chunk]);
    //         let start, end;
            
    //         while ((start = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]))) !== -1 &&
    //                (end = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]), start)) !== -1) {
    //             const frame = frameBuffer.slice(start, end + 2);
    //             frameBuffer = frameBuffer.slice(end + 2);
                
    //             // Send immediately - no interval delay!
    //             this.broadcastFrame(frame);
                
    //             // Store latest frame for snapshots
    //             latestFrontFrame = frame;
    //         }
    //     });

    start() {
        if (this.streaming) return;
        this.streaming = true;
        logger.info(`Starting stream for camera ${this.cameraId}`);
    
        this.ffmpeg = spawn('ffmpeg', [
            '-f', 'v4l2',
            '-input_format', 'h264',        // Changed from mjpeg
            '-flags', 'low_delay',
            '-fflags', 'nobuffer',
            '-probesize', '32',
            '-analyzeduration', '0',
            '-framerate', String(this.fps),
            '-video_size', `${this.width}x${this.height}`,
            '-i', this.devicePath,
            
            '-c:v', 'copy',                 // Just copy, no re-encoding!
            '-f', 'h264',                   // Output raw H.264
            '-flush_packets', '1',
            'pipe:1'
        ]);
    
        let nalBuffer = Buffer.alloc(0);
    
        this.ffmpeg.stdout.on('data', (chunk) => {
            nalBuffer = Buffer.concat([nalBuffer, chunk]);
            
            // Look for NAL unit start codes (0x00000001 or 0x000001)
            let start = 0;
            for (let i = 0; i < nalBuffer.length - 4; i++) {
                // Check for 4-byte start code
                if (nalBuffer[i] === 0x00 && nalBuffer[i+1] === 0x00 && 
                    nalBuffer[i+2] === 0x00 && nalBuffer[i+3] === 0x01) {
                    if (start > 0) {
                        const nalUnit = nalBuffer.slice(start, i);
                        this.broadcastFrame(nalUnit);
                    }
                    start = i;
                }
                // Check for 3-byte start code
                else if (nalBuffer[i] === 0x00 && nalBuffer[i+1] === 0x00 && 
                         nalBuffer[i+2] === 0x01) {
                    if (start > 0) {
                        const nalUnit = nalBuffer.slice(start, i);
                        this.broadcastFrame(nalUnit);
                    }
                    start = i;
                }
            }
            
            // Keep remaining data in buffer
            if (start > 0) {
                nalBuffer = nalBuffer.slice(start);
            }
        });

        this.ffmpeg.stderr.on('data', (data) => {
            this.io.emit(`ffmpeg`, data.toString());
        });

        this.ffmpeg.on('close', () => {
            this.stop();
            logger.info(`FFmpeg process closed for camera ${this.cameraId}`);
            this.io.emit(`message`, `Video stream stopped`);
        });
    }

    broadcastFrame(frame) {
        const now = Date.now();
        
        this.clients.forEach(client => {
            if (client.readyState !== WebSocket.OPEN) {
                return;
            }
            
            // Get or initialize client stats
            let stats = this.clientStats.get(client);
            if (!stats) {
                stats = { 
                    droppedFrames: 0, 
                    sentFrames: 0,
                    lastSent: 0,
                    skipCounter: 0
                };
                this.clientStats.set(client, stats);
            }
            
            // Adaptive frame skipping based on buffer size
            const bufferThreshold = 1000000; // 1MB - adjust based on testing
            const timeSinceLastFrame = now - stats.lastSent;
            const minFrameInterval = 33; // ~30fps max for slow clients
            
            // Skip frame if:
            // 1. Buffer is too full (client can't keep up)
            // 2. We're sending too fast for this client
            if (client.bufferedAmount > bufferThreshold) {
                stats.droppedFrames++;
                stats.skipCounter++;
                
                // Log if dropping a lot
                if (stats.droppedFrames % 30 === 0) {
                    logger.warn(`Client buffer full: ${client.bufferedAmount} bytes, dropped ${stats.droppedFrames} frames`);
                }
                return;
            }
            
            // For clients who can't keep up, throttle to max 30fps
            if (stats.skipCounter > 0 && timeSinceLastFrame < minFrameInterval) {
                return;
            }
            
            // Send the frame
            try {
                client.send(frame);
                stats.sentFrames++;
                stats.lastSent = now;
                
                // Gradually reduce skip counter if client is keeping up
                if (stats.skipCounter > 0) {
                    stats.skipCounter--;
                }
            } catch (error) {
                logger.error(`Error sending frame: ${error.message}`);
            }
        });
    }

    addClient(ws) {
        this.clients.add(ws);
        logger.info(`Client connected, total clients: ${this.clients.size}`);
        
        // Initialize stats
        this.clientStats.set(ws, {
            droppedFrames: 0,
            sentFrames: 0,
            lastSent: 0,
            skipCounter: 0
        });
        
        ws.on('close', () => {
            this.clients.delete(ws);
            this.clientStats.delete(ws);
            logger.info(`Client disconnected, total clients: ${this.clients.size}`);
        });
        
        ws.on('error', (error) => {
            logger.error(`WebSocket error: ${error.message}`);
        });
    }

    stop() {
        if (this.ffmpeg) {
            this.ffmpeg.kill('SIGTERM');
            this.ffmpeg = null;
        }
        this.streaming = false;

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
};