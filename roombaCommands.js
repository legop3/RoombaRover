const { port } = require('./serialPort');

/**
 * Sends the Drive Direct command to the Roomba.
 * @param {number} rightVelocity - Right wheel velocity (-500 to 500 mm/s)
 * @param {number} leftVelocity - Left wheel velocity (-500 to 500 mm/s)
 */
function driveDirect(rightVelocity, leftVelocity) {
    // Clamp velocities to valid range
    rightVelocity = Math.max(-500, Math.min(500, rightVelocity));
    leftVelocity = Math.max(-500, Math.min(500, leftVelocity));

    // Convert to 16-bit signed integers (big-endian)
    const rightHigh = (rightVelocity >> 8) & 0xFF;
    const rightLow = rightVelocity & 0xFF;
    const leftHigh = (leftVelocity >> 8) & 0xFF;
    const leftLow = leftVelocity & 0xFF;

    const command = Buffer.from([145, rightHigh, rightLow, leftHigh, leftLow]);
    // console.log(`Sending Drive Direct command: Right=${rightVelocity}mm/s, Left=${leftVelocity}mm/s`);

    try {
        port.write(command);
    } catch (err) {
        console.error('Error writing to port:', err.message);
    }
}

/**
 * Send a song to the Roomba and play it.
 * 
 * @param {SerialPort} port - An already-open instance of SerialPort
 * @param {number} songNumber - The song number (0–4)
 * @param {[number, number][]} notes - Array of [MIDI note number, duration] pairs
 */
function playRoombaSong(port, songNumber, notes) {
    if (songNumber < 0 || songNumber > 4) {
      throw new Error('Song number must be between 0 and 4.');
    }
    if (notes.length < 1 || notes.length > 16) {
      throw new Error('Song must contain between 1 and 16 notes.');
    }
  
    const songLength = notes.length;
    const songCommand = [140, songNumber, songLength];
  
    for (const [note, duration] of notes) {
      if (note < 31 || note > 127) {
        throw new Error(`Invalid note number: ${note}. Must be between 31 and 127.`);
      }
      if (duration < 0 || duration > 255) {
        throw new Error(`Invalid duration: ${duration}. Must be between 0 and 255.`);
      }
      songCommand.push(note, duration);
    }
  
    const playCommand = [141, songNumber];
  
    port.write(Buffer.from(songCommand), (err) => {
      if (err) {
        console.error('Failed to send song:', err.message);
        return;
      }
  
      // Delay a bit to ensure Roomba registers the song
      setTimeout(() => {
        port.write(Buffer.from(playCommand), (err) => {
          if (err) {
            console.error('Failed to play song:', err.message);
          } else {
            console.log(`Song ${songNumber} is playing.`);
          }
        });
      }, 100); // ms
    });
  }


//roombacontroller command to drive with distance and degrees
const { Buffer } = require('buffer');
const EventEmitter = require('events');

// Constants
const WHEEL_BASE_MM = 235; // mm
const MAX_SPEED = 200;     // mm/s

class RoombaController extends EventEmitter {
  constructor(serialPort) {
    super();
    if (!serialPort || !serialPort.write) {
      throw new Error("Invalid SerialPort instance");
    }

    this.serialPort = serialPort;
    this.queue = [];
    this.busy = false;
    this.currentTimeout = null;
  }

  /**
   * Adds a move command to the queue.
   * @param {number} distanceMm - Forward/backward distance in mm (positive = forward)
   * @param {number} turnDeg - Degrees to turn (positive = left, negative = right)
   * @param {number} speed - Optional speed in mm/s (default: 200)
   */
  move(distanceMm, turnDeg, speed = 200) {
    this.queue.push({ distanceMm, turnDeg, speed });
    this._processQueue();
  }

  _processQueue() {
    if (this.busy || this.queue.length === 0) return;

    const { distanceMm, turnDeg, speed } = this.queue.shift();
    this.busy = true;

    const safeSpeed = Math.min(Math.abs(speed), MAX_SPEED);

    // Convert turn degrees to arc length
    const turnRad = turnDeg * (Math.PI / 180);
    const arc = (turnRad * WHEEL_BASE_MM) / 2;

    // Distance each wheel needs to travel
    const leftDistance = distanceMm - arc;
    const rightDistance = distanceMm + arc;

    // Time to complete movement
    const maxDist = Math.max(Math.abs(leftDistance), Math.abs(rightDistance));
    const duration = (maxDist / safeSpeed) * 1000; // ms

    // Velocity for each wheel
    const leftVelocity = Math.round((leftDistance / maxDist) * safeSpeed);
    const rightVelocity = Math.round((rightDistance / maxDist) * safeSpeed);

    const [rvh, rvl] = this._toBytes(rightVelocity);
    const [lvh, lvl] = this._toBytes(leftVelocity);

    const command = Buffer.from([145, rvh, rvl, lvh, lvl]);
    this.serialPort.write(command);

    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }

    this.currentTimeout = setTimeout(() => {
      this.currentTimeout = null;
      // Stop
      this.serialPort.write(Buffer.from([145, 0x00, 0x00, 0x00, 0x00]));
      this.busy = false;
      this.emit('roomba:done', { distanceMm, turnDeg });

      if (this.queue.length > 0) {
        this._processQueue();
      } else {
        this.emit('roomba:queue-empty');
      }
    }, duration);
  }

  _toBytes(value) {
    const v = value < 0 ? 0x10000 + value : value;
    return [(v >> 8) & 0xFF, v & 0xFF];
  }

  clearQueue() {
    this.queue = [];
  }

  stop() {
    this.clearQueue();
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }
    if (this.busy) {
      this.serialPort.write(Buffer.from([145, 0x00, 0x00, 0x00, 0x00]));
      this.busy = false;
      this.emit('roomba:done', { distanceMm: 0, turnDeg: 0, aborted: true });
      this.emit('roomba:queue-empty');
    }
  }
}

// module.exports = RoombaController;



  
module.exports = {
    driveDirect,
    playRoombaSong,
    RoombaController
};

