const { port } = require('./roomba');

function readSensors() {
    return new Promise((resolve, reject) => {
        const command = Buffer.from([142, 1]); // Example: request sensor packet 1
        port.write(command, (err) => {
            if (err) return reject(err);
        });
        port.once('data', (data) => {
            // Parse as needed
            resolve({ raw: data.toString('hex') });
        });
    });
}

module.exports = {
    readSensors,
};