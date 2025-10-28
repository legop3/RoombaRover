require('./services/logCapture');

const { createLogger, setLogLevel } = require('./helpers/logger');
const config = require('./helpers/config');
const { server } = require('./globals/wsSocketExpress');
const logger = createLogger('Server');
const { exec } = require('child_process');

require('./services/spectatorBridge');
require('./services/accessControl');
require('./services/turnHandler');
require('./services/uiConfig');
require('./services/homeAssistantLights');
require('./services/ftdiGpio');
require('./services/roomCamera');
require('./controls/roverDriving');
require('./services/systemStats');
require('./services/socketHandlers');
require('./services/sensorService');
require('./services/batteryManager');
require('./services/discordBot');
require('./services/emergency');

if (config?.logging?.level) {
    try {
        setLogLevel(config.logging.level);
        logger.info(`Log level set from config: ${config.logging.level}`);
    } catch (error) {
        logger.warn(`Invalid log level in config: ${config.logging.level}`, error);
    }
}

const webport = config.express.port;
const roverDisplay = config.roverDisplay.enabled;

server.listen(webport, () => {
    logger.info(`Web server running on http://localhost:${webport}`);
    if (!roverDisplay) return;

    logger.info('Opening rover display');

    exec(`DISPLAY=:0 epiphany -p http://localhost:${webport}/viewer`, (error, stdout, stderr) => {
        if (error) {
            logger.error(`Error opening epiphany: ${error.message}`);
            return;
        }
        if (stderr) {
            logger.error(`Epiphany stderr: ${stderr}`);
            return;
        }
        logger.debug(`Epiphany stdout: ${stdout}`);
    });
});
