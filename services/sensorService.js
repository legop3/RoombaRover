const { port, tryWrite } = require('../globals/serialConnection');
const { createLogger } = require('../helpers/logger');
const { io } = require('../globals/wsSocketExpress');
const batteryManager = require('./batteryManager');
const roombaStatus = require('../globals/roombaStatus');

const logger = createLogger('SensorService');

const STREAM_HEADER = 0x13;
const SENSOR_PACKET_IDS = [
    7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    27, 28, 29, 30, 31, 34, 35, 36, 37, 38,
    39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
    49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
];
const STREAM_REQUEST = [148, SENSOR_PACKET_IDS.length, ...SENSOR_PACKET_IDS];
const STREAM_PAUSE = [150, 0];
const STREAM_RESUME = [150, 1];
const MAX_BUFFER_SIZE = 1024;
const WARNING_THROTTLE_MS = 5000;
const SENSOR_DEBUG_PAYLOAD = process.env.SENSOR_DEBUG_PAYLOAD === 'true';
const SENSOR_EMIT_INTERVAL_RAW = Number.parseInt(process.env.SENSOR_EMIT_INTERVAL_MS ?? '', 10);
const SENSOR_EMIT_INTERVAL_MS = Number.isFinite(SENSOR_EMIT_INTERVAL_RAW) && SENSOR_EMIT_INTERVAL_RAW > 0
    ? SENSOR_EMIT_INTERVAL_RAW
    : 60;

const SENSOR_PACKET_LENGTHS = {
    7: 1,
    8: 1,
    9: 1,
    10: 1,
    11: 1,
    12: 1,
    13: 1,
    14: 1,
    15: 1,
    16: 1,
    17: 1,
    18: 1,
    19: 2,
    20: 2,
    21: 1,
    22: 2,
    23: 2,
    24: 1,
    25: 2,
    26: 2,
    27: 2,
    28: 2,
    29: 2,
    30: 2,
    31: 2,
    34: 1,
    35: 1,
    36: 1,
    37: 1,
    38: 1,
    39: 2,
    40: 2,
    41: 2,
    42: 2,
    43: 2,
    44: 2,
    45: 1,
    46: 2,
    47: 2,
    48: 2,
    49: 2,
    50: 2,
    51: 2,
    52: 1,
    53: 1,
    54: 2,
    55: 2,
    56: 2,
    57: 2,
    58: 1,
};

let streamActive = false;
let errorCount = 0;
let startTime = Date.now();
let dataBuffer = Buffer.alloc(0);
let lastWarningAt = 0;
let latestPayload = null;
let lastEmitAt = 0;
let emitTimer = null;

port.on('open', () => {
    logger.info('Serial port open; ready to receive data');

    if (streamActive) {
        logger.info('Serial port reopened; re-requesting sensor stream');
        dataBuffer = Buffer.alloc(0);
        latestPayload = null;
        lastEmitAt = 0;

        tryWrite(port, STREAM_PAUSE);
        tryWrite(port, STREAM_REQUEST);
        tryWrite(port, STREAM_RESUME);
    }
});

port.on('data', (chunk) => {
    if (!chunk || !chunk.length) {
        return;
    }

    dataBuffer = Buffer.concat([dataBuffer, chunk]);

    while (dataBuffer.length >= 3) {
        const headerIndex = dataBuffer.indexOf(STREAM_HEADER);

        if (headerIndex === -1) {
            if (dataBuffer.length > MAX_BUFFER_SIZE) {
                logger.warn('No stream header found within buffer; clearing to resync');
                emitWarning('Sensor stream lost sync; clearing buffer...');
                recordParseError();
                dataBuffer = Buffer.alloc(0);
            }
            break;
        }

        if (headerIndex > 0) {
            dataBuffer = dataBuffer.slice(headerIndex);
        }

        if (dataBuffer.length < 3) {
            break;
        }

        const payloadLength = dataBuffer[1];
        const frameLength = payloadLength + 3;

        if (payloadLength <= 0 || frameLength > MAX_BUFFER_SIZE) {
            logger.warn(`Invalid sensor frame length (${payloadLength}); attempting resync`);
            emitWarning('Invalid sensor frame length detected; resyncing stream...');
            recordParseError();
            dataBuffer = dataBuffer.slice(1);
            continue;
        }

        if (dataBuffer.length < frameLength) {
            break;
        }

        const frame = dataBuffer.subarray(0, frameLength);

        if (!isValidFrame(frame)) {
            logger.warn('Sensor stream checksum mismatch; attempting resync');
            emitWarning('Sensor stream checksum mismatch; attempting resync...');
            recordParseError();
            dataBuffer = dataBuffer.slice(1);
            continue;
        }

        const payload = frame.subarray(2, frameLength - 1);
        const processed = processStreamPayload(payload);

        if (processed === false) {
            recordParseError();
        }

        dataBuffer = dataBuffer.slice(frameLength);
    }

    if (dataBuffer.length > MAX_BUFFER_SIZE) {
        logger.warn('Sensor stream buffer exceeded maximum size; clearing to resync');
        emitWarning('Sensor stream buffer exceeded safe size; clearing...');
        recordParseError();
        dataBuffer = Buffer.alloc(0);
    }
});

port.on('error', (err) => {
    logger.error('Serial port error', err);
});

function isValidFrame(frame) {
    let sum = 0;

    for (let i = 0; i < frame.length; i++) {
        sum = (sum + frame[i]) & 0xFF;
    }

    return sum === 0;
}

function processStreamPayload(payload) {
    const packets = {};
    let offset = 0;

    for (let i = 0; i < SENSOR_PACKET_IDS.length; i += 1) {
        const expectedId = SENSOR_PACKET_IDS[i];

        if (offset >= payload.length) {
            logger.warn(`Sensor stream truncated before packet ${expectedId}`);
            emitWarning('Sensor stream truncated; waiting for resync...');
            return false;
        }

        const packetId = payload[offset];
        offset += 1;

        if (packetId !== expectedId) {
            logger.warn(`Unexpected sensor packet id ${packetId}; expected ${expectedId}`);
            emitWarning(`Unexpected sensor packet ${packetId}; attempting resync...`);
            return false;
        }

        const packetLength = SENSOR_PACKET_LENGTHS[packetId];
        if (!packetLength) {
            logger.warn(`Length not configured for sensor packet ${packetId}; dropping frame`);
            emitWarning('Unsupported sensor packet encountered; waiting for resync...');
            return false;
        }

        if (offset + packetLength > payload.length) {
            logger.warn(`Incomplete data for sensor packet ${packetId}; dropping frame`);
            emitWarning('Incomplete sensor packet received; dropping frame...');
            return false;
        }

        packets[packetId] = payload.subarray(offset, offset + packetLength);
        offset += packetLength;
    }

    if (offset !== payload.length) {
        logger.debug(`Sensor stream payload has ${payload.length - offset} trailing bytes`);
    }

    if (!packets[21] || !packets[22] || !packets[25] || !packets[26]) {
        logger.debug('Essential battery packets missing from stream payload; skipping frame');
        return null;
    }

    try {
        const chargeStatus = readUInt8(packets[21]);
        const batteryCharge = readUInt16(packets[25]);
        const batteryCapacity = readUInt16(packets[26]);
        const chargingSources = readUInt8(packets[34]);
        const oiMode = readUInt8(packets[35]);
        const batteryVoltage = readUInt16(packets[22]);
        const brushCurrent = readInt16(packets[57]);
        const batteryCurrent = readInt16(packets[23]);
        const wallSignal = readUInt16(packets[27]);
        const rightCurrent = readInt16(packets[55]);
        const leftCurrent = readInt16(packets[54]);
        const lightBumpRaw = readUInt8(packets[45]);
        const bumpBits = readUInt8(packets[7]);
        const wall = readUInt8(packets[8]);
        const cliffLeft = readUInt8(packets[9]);
        const cliffFrontLeft = readUInt8(packets[10]);
        const cliffFrontRight = readUInt8(packets[11]);
        const cliffRight = readUInt8(packets[12]);
        const virtualWall = readUInt8(packets[13]);
        const cliffSensors = [
            readUInt16(packets[28]),
            readUInt16(packets[29]),
            readUInt16(packets[30]),
            readUInt16(packets[31]),
        ];
        const dirtDetect = readUInt8(packets[15]);
        const unusedByte = readUInt8(packets[16]);
        const infraredOmni = readUInt8(packets[17]);
        const buttonsRaw = readUInt8(packets[18]);
        const distance = readInt16(packets[19]);
        const angle = readInt16(packets[20]);
        const mainBrushCurrent = readInt16(packets[56]);
        const overcurrentBits = readUInt8(packets[14]);
        const batteryTemperature = readInt8(packets[24]);
        const songNumber = readUInt8(packets[36]);
        const songPlaying = readUInt8(packets[37]);
        const numberOfStreamPackets = readUInt8(packets[38]);
        const requestedVelocity = readInt16(packets[39]);
        const requestedRadius = readInt16(packets[40]);
        const requestedRightVelocity = readInt16(packets[41]);
        const requestedLeftVelocity = readInt16(packets[42]);
        const leftEncoderCounts = readUInt16(packets[43]);
        const rightEncoderCounts = readUInt16(packets[44]);
        const infraredLeft = readUInt8(packets[52]);
        const infraredRight = readUInt8(packets[53]);
        const stasis = readUInt8(packets[58]);

        const bumpSensors = [
            readUInt16(packets[46]),
            readUInt16(packets[47]),
            readUInt16(packets[48]),
            readUInt16(packets[49]),
            readUInt16(packets[50]),
            readUInt16(packets[51]),
        ];

        const bumpRight = bumpBits & 0x01;
        const bumpLeft = (bumpBits >> 1) & 0x01;
        const wheelDropRight = (bumpBits >> 2) & 0x01;
        const wheelDropLeft = (bumpBits >> 3) & 0x01;

        const overcurrents = {
            leftWheel: (overcurrentBits & 0x10) ? 'ON' : 'OFF',
            rightWheel: (overcurrentBits & 0x08) ? 'ON' : 'OFF',
            mainBrush: (overcurrentBits & 0x04) ? 'ON' : 'OFF',
            sideBrush: (overcurrentBits & 0x01) ? 'ON' : 'OFF',
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
        const chargeAlert = batteryInfo.chargeAlert;
        const buttons = {
            clean: Boolean(buttonsRaw & 0x01),
            spot: Boolean((buttonsRaw >> 1) & 0x01),
            dock: Boolean((buttonsRaw >> 2) & 0x01),
            minute: Boolean((buttonsRaw >> 3) & 0x01),
            hour: Boolean((buttonsRaw >> 4) & 0x01),
            day: Boolean((buttonsRaw >> 5) & 0x01),
            schedule: Boolean((buttonsRaw >> 6) & 0x01),
            clock: Boolean((buttonsRaw >> 7) & 0x01),
            raw: buttonsRaw,
        };
        const lightBumpDetections = {
            left: Boolean(lightBumpRaw & 0x01),
            frontLeft: Boolean((lightBumpRaw >> 1) & 0x01),
            centerLeft: Boolean((lightBumpRaw >> 2) & 0x01),
            centerRight: Boolean((lightBumpRaw >> 3) & 0x01),
            frontRight: Boolean((lightBumpRaw >> 4) & 0x01),
            right: Boolean((lightBumpRaw >> 5) & 0x01),
            raw: lightBumpRaw,
        };
        const cliffBoolean = {
            left: Boolean(cliffLeft),
            frontLeft: Boolean(cliffFrontLeft),
            frontRight: Boolean(cliffFrontRight),
            right: Boolean(cliffRight),
        };
        const infrared = {
            omni: infraredOmni,
            left: infraredLeft,
            right: infraredRight,
        };
        const requested = {
            velocity: requestedVelocity,
            radius: requestedRadius,
            rightVelocity: requestedRightVelocity,
            leftVelocity: requestedLeftVelocity,
        };
        const encoders = {
            left: leftEncoderCounts,
            right: rightEncoderCounts,
        };
        const motorCurrents = {
            leftWheel: leftCurrent,
            rightWheel: rightCurrent,
            mainBrush: mainBrushCurrent,
            sideBrush: brushCurrent,
        };
        let debugAllSensors = null;
        let debugRawPackets = null;

        if (SENSOR_DEBUG_PAYLOAD) {
            debugAllSensors = {
                bumpAndWheelDropsRaw: bumpBits,
                bumpDetections: {
                    left: Boolean(bumpLeft),
                    right: Boolean(bumpRight),
                    wheelDropLeft: Boolean(wheelDropLeft),
                    wheelDropRight: Boolean(wheelDropRight),
                },
                wall,
                cliff: cliffBoolean,
                virtualWall,
                dirtDetect,
                unusedByte,
                infrared,
                buttons,
                distance,
                angle,
                batteryTemperature,
                batteryCharge,
                batteryCapacity,
                batteryCurrent,
                batteryVoltage,
                wallSignal,
                cliffSignals: {
                    left: cliffSensors[0],
                    frontLeft: cliffSensors[1],
                    frontRight: cliffSensors[2],
                    right: cliffSensors[3],
                },
                chargingSources,
                oiMode,
                songNumber,
                songPlaying: Boolean(songPlaying),
                numberOfStreamPackets,
                requested,
                encoders,
                lightBumpDetections,
                lightBumpSignals: {
                    left: bumpSensors[0],
                    frontLeft: bumpSensors[1],
                    centerLeft: bumpSensors[2],
                    centerRight: bumpSensors[3],
                    frontRight: bumpSensors[4],
                    right: bumpSensors[5],
                },
                motorCurrents,
                overcurrentsRaw: overcurrentBits,
                stasis,
            };

            debugRawPackets = {};
            for (const packetId of SENSOR_PACKET_IDS) {
                const packet = packets[packetId];
                if (packet) {
                    debugRawPackets[`packet${packetId}`] = Buffer.from(packet);
                }
            }
        }

        const payload = {
            chargeStatus,
            batteryCharge,
            batteryCapacity,
            batteryPercentage: computedPercentage,
            chargingSources,
            oiMode,
            batteryVoltage,
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
            distance,
            angle,
            wall,
            cliffBoolean,
            virtualWall,
            infrared,
            buttons,
            batteryTemperature,
            songNumber,
            songPlaying: Boolean(songPlaying),
            numberOfStreamPackets,
            requested,
            encoders,
            lightBumpDetections,
            motorCurrents,
            stasis,
        };

        if (SENSOR_DEBUG_PAYLOAD) {
            payload.rawPackets = debugRawPackets;
            payload.allSensors = debugAllSensors;
        }

        latestPayload = payload;
        if (lastEmitAt === 0) {
            emitLatestSensorData(true);
        }
    } catch (error) {
        logger.error('Failed to process sensor stream payload', error);
        return false;
    }

    return true;
}

function readUInt8(buffer, fallback = 0) {
    if (!buffer || buffer.length < 1) {
        return fallback;
    }
    return buffer[0];
}

function readUInt16(buffer, fallback = 0) {
    if (!buffer || buffer.length < 2) {
        return fallback;
    }
    return buffer.readUInt16BE(0);
}

function readInt16(buffer, fallback = 0) {
    if (!buffer || buffer.length < 2) {
        return fallback;
    }
    return buffer.readInt16BE(0);
}

function readInt8(buffer, fallback = 0) {
    if (!buffer || buffer.length < 1) {
        return fallback;
    }
    return buffer.readInt8(0);
}

function recordParseError() {
    errorCount += 1;
    const now = Date.now();
    const elapsedSeconds = (now - startTime) / 1000;

    if (elapsedSeconds >= 10) {
        const errorsPerSecond = errorCount / elapsedSeconds;
        logger.warn(`Sensor stream parse errors per second: ${errorsPerSecond.toFixed(2)}`);
        errorCount = 0;
        startTime = now;
    }
}

function emitLatestSensorData(force = false) {
    if (!latestPayload) {
        return;
    }

    const now = Date.now();

    if (!force && now - lastEmitAt < SENSOR_EMIT_INTERVAL_MS) {
        return;
    }

    lastEmitAt = now;
    io.emit('SensorData', latestPayload);
}

function emitWarning(message) {
    const now = Date.now();

    if (now - lastWarningAt < WARNING_THROTTLE_MS) {
        return;
    }

    io.emit('warning', message);
    lastWarningAt = now;
}

function startPolling() {
    logger.info('Sensor data stream requested');

    dataBuffer = Buffer.alloc(0);
    latestPayload = null;
    lastEmitAt = 0;

    tryWrite(port, STREAM_PAUSE);
    tryWrite(port, STREAM_REQUEST);
    tryWrite(port, STREAM_RESUME);

    if (!emitTimer) {
        emitTimer = setInterval(emitLatestSensorData, SENSOR_EMIT_INTERVAL_MS);
    }

    streamActive = true;
    logger.info('Sensor data streaming active');
}

function stopPolling() {
    if (!streamActive) {
        return;
    }

    tryWrite(port, STREAM_PAUSE);
    streamActive = false;
    dataBuffer = Buffer.alloc(0);
    latestPayload = null;
    lastEmitAt = 0;

    if (emitTimer) {
        clearInterval(emitTimer);
        emitTimer = null;
    }

    logger.info('Sensor data stream paused');
}

module.exports = {
    startPolling,
    stopPolling,
    isPolling: () => Boolean(streamActive),
};
