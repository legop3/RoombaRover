/**
 * Global container for Express, socket.io, and WebSocket.
 * Provides centralized instances that can be imported by other modules.
 * 
 * Usage in other modules:
 *   const { app, io, wss } = require('./globals/wsSocketExpress');
 * 
 * To start the server, call the exported `start` function with the (optional) desired port.
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const { createLogger } = require('../helpers/logger');
const config = require('../helpers/config');

const expressLogger = createLogger('Express G');
const socketLogger = createLogger('SocketIO G');
const wsLogger = createLogger('WebSocket G');

// Create instances but don't start listening yet
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const wss = new WebSocket.Server({ port:3001, perMessageDeflate: false });

// Apply middleware
app.use(express.static('public'));

// Socket.IO connection handling
io.on('connection', (socket) => {
  socketLogger.info(`New client connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    socketLogger.info(`Client disconnected: ${socket.id}`);
  });
});

// WebSocket connection handling
// wss.on('connection', (ws) => {
//   wsLogger.info('New WebSocket client connected');
  
//   ws.on('message', (message) => {
//     // wsLogger.debug(`Received message: ${message}`);
//   });
  
//   ws.on('close', () => {
//     wsLogger.info('WebSocket client disconnected');
//   });
  
//   ws.on('error', (error) => {
//     wsLogger.error(`WebSocket error: ${error.message}`);
//   });
// });

// Handle WebSocket upgrades
// server.on('upgrade', (request, socket, head) => {
//   try {
//     const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
//     if (pathname === '/video-stream') {
//       wss.handleUpgrade(request, socket, head, (ws) => {
//         wss.emit('connection', ws, request);
//       });
//     } else {
//       // Socket.IO handles its own upgrades automatically
//       // If it's not handled by Socket.IO or our WS, destroy the socket
//       socket.destroy();
//     }
//   } catch (error) {
//     wsLogger.error(`Upgrade error: ${error.message}`);
//     socket.destroy();
//   }
// });

// Separate start function
const start = (port = config.server.port || 3000) => {
  return new Promise((resolve, reject) => {
    server.listen(port, (err) => {
      if (err) {
        expressLogger.error(`Failed to start server: ${err.message}`);
        reject(err);
      } else {
        expressLogger.info(`Express server listening on port ${port}`);
        resolve(server);
      }
    });
  });
};

module.exports = {
  app,
  server,
  io,
  wss,
  start
};