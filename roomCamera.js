const { getServer } = require('./ioContext');
const { createLogger } = require('./logger');
const config = require('./config');
const axios = require('axios')
const io = getServer();
const logger = createLogger('RoomCamera');
logger.info('Starting module');
const snapshotURL = config?.roomCamera.snapshotURL || ""

async function pushRoomSnapshot(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 5000 // 5 second timeout
    });
    const buffer = Buffer.from(response.data);
    io.emit('room-camera-frame', buffer);
    // logger.info(`Sending room camera image of length ${buffer.length}`);
  } catch (error) {
    logger.error(`Failed to fetch/send room camera snapshot: ${error.message}`);
    if (error.code) {
      logger.error(`Error code: ${error.code}`);
    }
  }
}

if(config?.roomCamera.enabled) {
  if (!snapshotURL) {
    logger.error('Room camera enabled but snapshotURL is not configured!');
  } else {
    logger.info(`ROOM CAMERA ENABLED. Snapshot URL: ${snapshotURL}`);
    logger.info('Starting room camera stream');
    setInterval(() => pushRoomSnapshot(snapshotURL), 250);
  }
}