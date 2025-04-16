const { SerialPort } = require('serialport'); // Correct import for SerialPort
const { ReadlineParser } = require('@serialport/parser-readline'); // Correct import for ReadlineParser

// Replace with the correct serial port for your Roomba
const portPath = '/dev/ttyACM0'; // Update this to match your system
const baudRate = 115200; // Default baud rate for Roomba Create 2

// Initialize the serial port
const port = new SerialPort({ path: portPath, baudRate: baudRate }, (err) => {
    if (err) {
        return console.error('Error opening port:', err.message);
    }
    console.log('Serial port opened successfully');
});

// Set up a parser to read incoming data
// const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

// Framework to handle incoming messages
port.on('data', (data) => {
    console.log('Raw Data:', data); // Log raw data for debugging
    try {
        const parsedData = parseRoombaMessage(data);
        console.log('Parsed Data:', parsedData);
    } catch (err) {
        console.error('Error parsing data:', err.message);
    }
});

// Function to parse messages from the Roomba
function parseRoombaMessage(data) {
    // Example: Convert incoming data to a readable format
    // You can extend this to handle specific sensor packets or other data
    const buffer = Buffer.from(data, 'utf-8');
    // console.log(buffer.toString('ascii'));

    return {
        raw: buffer,
        hex: buffer.toString('hex'),
        ascii: buffer.toString('ascii'),
    };
}

// Function to send an opcode with optional data bytes to the Roomba
function sendRoombaCommand(opcode, data = []) {
    const command = Buffer.from([opcode, ...data]);
    port.write(command, (err) => {
        if (err) {
            return console.error(`Error sending command (opcode: ${opcode}):`, err.message);
        }
        console.log(`Command sent (opcode: ${opcode}, data: [${data.join(', ')}])`);
    });
}


/**
 * Sets the wheel speeds of the Roomba.
 * @param {SerialPort} port - The serial port connected to the Roomba.
 * @param {number} leftSpeed - Speed of the left wheel in mm/s (-500 to 500).
 * @param {number} rightSpeed - Speed of the right wheel in mm/s (-500 to 500).
 */
function setWheelSpeeds(port, leftSpeed, rightSpeed) {
    // Ensure speeds are within the valid range (-500 to 500 mm/s)
    leftSpeed = Math.max(-500, Math.min(500, leftSpeed));
    rightSpeed = Math.max(-500, Math.min(500, rightSpeed));
  
    // Convert speeds to high and low bytes
    const leftHigh = (leftSpeed >> 8) & 0xFF;
    const leftLow = leftSpeed & 0xFF;
    const rightHigh = (rightSpeed >> 8) & 0xFF;
    const rightLow = rightSpeed & 0xFF;
  
    // Create the command buffer
    const command = Buffer.from([
      145,        // DRIVE opcode
      rightHigh,  // High byte of right wheel speed
      rightLow,   // Low byte of right wheel speed
      leftHigh,   // High byte of left wheel speed
      leftLow,    // Low byte of left wheel speed
    ]);
  
    // Send the command to the Roomba
    port.write(command, (err) => {
      if (err) {
        console.error('Error sending wheel speeds:', err.message);
      } else {
        console.log(`Wheel speeds set: Left=${leftSpeed}, Right=${rightSpeed}`);
      }
    });
  }


// Open the port and send initial commands to the Roomba
port.on('open', () => {
    console.log('Port is open. Sending commands to Roomba...');


    // reset command (7) to reset the Roomba
    // sendRoombaCommand(7);
    // port.write(Buffer.from([7])); // Request sensor packet 1
    // Start command (128) to wake up the Roomba
    sendRoombaCommand(128);
    // port.write(Buffer.from([128])); // Start command
    // port.write(Buffer.from([131])); // Safe mode command
    // port.write(Buffer.from([143])) // Dock command
    
    // Safe mode command (131) to put Roomba in safe mode
    sendRoombaCommand(132);

    setWheelSpeeds(port, 20, 20)

    // dock
    // sendRoombaCommand(143);
    
    // sendRoombaCommand(173);

    // sendRoombaCommand(148, [8])

    // sendRoombaCommand(145, [1, 1, 1, 1])
    // sendRoombaCommand(145, [0, 0, 0, 0])

    // port.write(Buffer.from([146, 1, 1, 1, 1]))

    // Example: Add more commands as needed
    // sendRoombaCommand(135, [0, 1]); // Example of sending an opcode with data
});

// Handle errors
port.on('error', (err) => {
    console.error('Serial port error:', err.message);
});