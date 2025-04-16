const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

class RoombaCreate2 {
    constructor(portPath = '/dev/ttyACM0') {
        this.port = new SerialPort({
            path: portPath,
            baudRate: 115200
        });
        this.sensors = {
            bumpers: 0,
            batteryCharge: 0,
            cliffSensors: [0, 0, 0, 0]
        };
    }

    // Initialize Roomba in Safe Mode
    async init() {
        await this.sendCommand([128]); // START
        await new Promise(resolve => setTimeout(resolve, 50));
        await this.sendCommand([132]); // SAFE MODE
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Send raw commands to Roomba
    async sendCommand(bytes) {
        return new Promise((resolve, reject) => {
            this.port.write(Buffer.from(bytes), (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Set individual wheel speeds (-500 to 500 mm/s)
    async setWheelSpeeds(rightWheel, leftWheel) {
        const rightHigh = (rightWheel >> 8) & 0xFF;
        const rightLow = rightWheel & 0xFF;
        const leftHigh = (leftWheel >> 8) & 0xFF;
        const leftLow = leftWheel & 0xFF;

        await this.sendCommand([145, rightHigh, rightLow, leftHigh, leftLow]);
    }

    // Drive straight
    async driveStraight(speed) {
        await this.setWheelSpeeds(speed, speed);
    }

    // Rotate in place
    async rotate(speed) {
        await this.setWheelSpeeds(speed, -speed);
    }

    // Stop movement
    async stop() {
        await this.setWheelSpeeds(0, 0);
    }

    // Read sensors
    async readSensors() {
        // Request sensor data packet 100 (all sensors)
        await this.sendCommand([142, 100]);
        
        return new Promise((resolve) => {
            this.port.once('data', (data) => {
                // Parse sensor data
                this.sensors.bumpers = data[0];
                this.sensors.batteryCharge = (data[22] << 8) | data[23];
                this.sensors.cliffSensors = [
                    (data[9] << 8) | data[10],  // Left
                    (data[11] << 8) | data[12], // Front Left
                    (data[13] << 8) | data[14], // Front Right
                    (data[15] << 8) | data[16]  // Right
                ];
                resolve(this.sensors);
            });
        });
    }

    // Clean up and close connection
    async close() {
        await this.stop();
        this.port.close();
    }
}

// Example usage:
async function main() {
    const roomba = new RoombaCreate2();
    
    try {
        await roomba.init();
        console.log('Roomba initialized');

        // Drive forward for 2 seconds
        await roomba.driveStraight(200);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Read sensors
        const sensorData = await roomba.readSensors();
        console.log('Sensor data:', sensorData);

        // Stop
        await roomba.stop();

        // Clean up
        await roomba.close();
    } catch (error) {
        console.error('Error:', error);
        await roomba.close();
    }
}

// Run the example
main().catch(console.error);