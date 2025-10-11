const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { createLogger } = require('./logger');

const CONFIG_PATH = path.join(__dirname, '../config.yaml');
const logger = createLogger('Config');

function loadConfig() {
    const file = fs.readFileSync(CONFIG_PATH, 'utf8');
    return YAML.parse(file);
}

let config;
try {
    config = loadConfig();
} catch (error) {
    logger.error(`Failed to load configuration from ${CONFIG_PATH}`, error);
    throw error;
}

module.exports = config;
module.exports.load = loadConfig;
module.exports.path = CONFIG_PATH;
