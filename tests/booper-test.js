const { SerialPort } = require('serialport');

const port = new SerialPort({ path: '/dev/ttyACM0', baudRate: 115200 });


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



port.on('open', () => {
  console.log('Port opened');

  port.write([132])

  playRoombaSong(port, 0, [
    [60, 10]
  ]);



}
);
port.on('data', (data) => {
  console.log('Data received:', data.toString());
});
port.on('error', (err) => {
  console.error('Error:', err.message);
});