const { port, tryWrite } = require('../globals/serialConnection');
const { createLogger } = require('../helpers/logger');

let instance = null;

function createSensorService({ io, batteryManager, roombaStatus }) {
    if (instance) {
        return instance;
    }

    const logger = createLogger('SensorService');

    let sensorPoll = null;
    let errorCount = 0;
    let startTime = Date.now();
    let dataBuffer = Buffer.alloc(0);
    const expectedPacketLength = 44;
    let consecutiveValidPackets = 0;

    port.on('open', () => {
        logger.info('Serial port open; ready to receive data');
    });

    port.on('data', (data) => {
        dataBuffer = Buffer.concat([dataBuffer, data]);

        while (dataBuffer.length >= expectedPacketLength) {
            const packet = dataBuffer.slice(0, expectedPacketLength);

            if (isValidPacket(packet)) {
                consecutiveValidPackets++;
                dataBuffer = dataBuffer.slice(expectedPacketLength);
                processPacket(packet);
            } else {
                logger.warn('Invalid sensor packet detected; attempting resync');
                io.emit('warning', 'Invalid packet detected, attempting resync...');
                consecutiveValidPackets = 0;

                let foundSync = false;
                for (let i = 1; i < Math.min(dataBuffer.length - expectedPacketLength + 1, 50); i++) {
                    const testPacket = dataBuffer.slice(i, i + expectedPacketLength);
                    if (isValidPacket(testPacket)) {
                        logger.debug(`Found sensor packet sync at offset ${i}`);
                        io.emit('warning', `Found sync at offset ${i}`);
                        dataBuffer = dataBuffer.slice(i);
                        foundSync = true;
                        break;
                    }
                }

                if (!foundSync) {
                    logger.warn('No valid sync found; clearing sensor buffer');
                    io.emit('warning', 'No valid sync found, clearing buffer...');
                    dataBuffer = Buffer.alloc(0);
                }
            }
        }

        if (dataBuffer.length > expectedPacketLength * 5) {
            logger.warn('Sensor buffer too large; clearing to resync');
            io.emit('warning', 'Buffer too large, clearing to resync...');
            dataBuffer = Buffer.alloc(0);
            consecutiveValidPackets = 0;
        }
    });

    port.on('error', (err) => {
        logger.error('Serial port error', err);
    });

    function isValidPacket(data) {
        if (data.length !== expectedPacketLength) return false;

        try {
            const chargeStatus = data[0];
            const batteryCharge = data.readInt16BE(1);
            const batteryCapacity = data.readInt16BE(3);
            const chargingSources = data[5];
            const oiMode = data[6];
            const batteryVoltage = data.readInt16BE(7);
            const dirtDetect = data[40];

            if (batteryVoltage < 1000 || batteryVoltage > 20000) return false;
            if (chargeStatus < 0 || chargeStatus > 6) return false;
            if (oiMode < 0 || oiMode > 255) return false;
            if (chargingSources < 0 || chargingSources > 255) return false;
            if (batteryCapacity < 2068 || batteryCapacity > 2068) return false;

            const bumpSensor1 = data.readInt16BE(13);
            const bumpSensor2 = data.readInt16BE(15);

            if (bumpSensor1 < 0 || bumpSensor1 > 5000) return false;
            if (bumpSensor2 < 0 || bumpSensor2 > 5000) return false;
            if (dirtDetect !== 0) return false;

            return true;
        } catch (err) {
            return false;
        }
    }

    function processPacket(data) {
        try {
            const chargeStatus = data[0];
            const batteryCharge = data.readInt16BE(1);
            const batteryCapacity = data.readInt16BE(3);
            const chargingSources = data[5];
            const oiMode = data[6];
            const batteryVoltage = data.readInt16BE(7);
            const brushCurrent = data.readInt16BE(9);
            const batteryCurrent = data.readInt16BE(11);
            const bumpSensors = Array.from({ length: 6 }, (_, i) => data.readInt16BE(13 + i * 2));
            const wallSignal = data.readInt16BE(25);
            const rightCurrent = data.readInt16BE(27);
            const leftCurrent = data.readInt16BE(29);

            const bumpRight = data[31] & 0x01;
            const bumpLeft = (data[31] & 0x02) >> 1;
            const wheelDropRight = (data[31] & 0x04) >> 2;
            const wheelDropLeft = (data[31] & 0x08) >> 3;

            const cliffSensors = [
                data.readInt16BE(32),
                data.readInt16BE(34),
                data.readInt16BE(36),
                data.readInt16BE(38)
            ];

            const dirtDetect = data[40];
            const mainBrushCurrent = data.readInt16BE(41);
            const overcurrentBits = data[43];
            const overcurrents = {
                leftWheel: (overcurrentBits & 0x10) ? 'ON' : 'OFF',
                rightWheel: (overcurrentBits & 0x08) ? 'ON' : 'OFF',
                mainBrush: (overcurrentBits & 0x04) ? 'ON' : 'OFF',
                sideBrush: (overcurrentBits & 0x01) ? 'ON' : 'OFF'
            };

            const batteryInfo = batteryManager.handleSensorUpdate({
                chargeStatus,
                batteryCharge,
                batteryCapacity,
                batteryVoltage,
                chargingSources,
            });

            roombaStatus.lightBumps.LBL = bumpSensors[0];
            roombaStatus.lightBumps.LBFL = bumpSensors[1];
            roombaStatus.lightBumps.LBCL = bumpSensors[2];
            roombaStatus.lightBumps.LBCR = bumpSensors[3];
            roombaStatus.lightBumps.LBFR = bumpSensors[4];
            roombaStatus.lightBumps.LBR = bumpSensors[5];

            roombaStatus.bumpSensors.bumpLeft = bumpLeft ? 'ON' : 'OFF';
            roombaStatus.bumpSensors.bumpRight = bumpRight ? 'ON' : 'OFF';
            roombaStatus.overcurrents = overcurrents;

            const computedPercentage = batteryInfo.batteryPercentage;
            const filteredVoltage = batteryInfo.filteredVoltage;
            const chargeAlert = batteryInfo.chargeAlert;

            io.emit('SensorData', {
                chargeStatus,
                batteryCharge,
                batteryCapacity,
                batteryPercentage: computedPercentage,
                chargingSources,
                oiMode,
                batteryVoltage,
                batteryVoltageFiltered: filteredVoltage,
                brushCurrent,
                batteryCurrent,
                bumpSensors,
                wallSignal,
                rightCurrent,
                leftCurrent,
                bumpLeft,
                bumpRight,
                wheelDropRight,
                wheelDropLeft,
                cliffSensors,
                mainBrushCurrent,
                dirtDetect,
                overcurrents,
                chargeAlert,
            });
        } catch (err) {
            errorCount++;

            const currentTime = Date.now();
            const elapsedSeconds = (currentTime - startTime) / 1000;

            if (elapsedSeconds >= 10) {
                const errorsPerSecond = errorCount / elapsedSeconds;
                logger.warn(`Sensor packet parse errors per second: ${errorsPerSecond.toFixed(2)}`);
                errorCount = 0;
                startTime = currentTime;
            }
        }
    }

    function getSensorData() {
        tryWrite(port, [149, 25, 21, 25, 26, 34, 35, 22, 57, 23, 46, 47, 48, 49, 50, 51, 27, 55, 54, 7, 28, 29, 30, 31, 15, 56, 14]);
    }

    function startPolling() {
        logger.info('Sensor data stream requested');

        if (!sensorPoll) {
            logger.info('Starting sensor data polling');
            sensorPoll = setInterval(getSensorData, 60);
        } else {
            logger.debug('Sensor data already being polled; restarting');
            clearInterval(sensorPoll);
            sensorPoll = setInterval(getSensorData, 60);
            logger.info('Restarting sensor data polling');
        }
    }

    function stopPolling() {
        if (!sensorPoll) {
            return;
        }

        clearInterval(sensorPoll);
        sensorPoll = null;
        logger.info('Stopping sensor data polling');
    }

    instance = {
        startPolling,
        stopPolling,
        isPolling: () => Boolean(sensorPoll),
    };

    return instance;
}

module.exports = {
    createSensorService,
};
