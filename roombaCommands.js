const port = require('./serialPort');

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
    console.log(`Sending Drive Direct command: Right=${rightVelocity}mm/s, Left=${leftVelocity}mm/s`);

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
  
module.exports = {
    driveDirect,
    playRoombaSong
};

