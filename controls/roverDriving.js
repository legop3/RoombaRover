const { io } = require('../globals/wsSocketExpress');
const { port, tryWrite } = require('../globals/serialConnection');
const { driveDirect, auxMotorSpeeds } = require('../helpers/roombaCommands');
const config = require('../helpers/config');
const { createLogger } = require('../helpers/logger');
const { roombaStatus } = require('../globals/roombaStatus');

const logger = createLogger('RoverDriving');

io.on('connection', (socket) => {
    logger.info(`Client connected for rover driving: ${socket.id}`);

    socket.on('Speedchange', (data) => {
        // console.log(data)
        socket.lastDriveCommandAt = Date.now();
        roombaStatus.lastDriveCommandAt = socket.lastDriveCommandAt;
        driveDirect(data.rightSpeed, data.leftSpeed);
    });

    socket.on('Docking', (data) => {
        if (data.action == 'dock') {
            tryWrite(port, [143]); // Dock command
        }
        if (data.action == 'reconnect') {
            tryWrite(port, [128]); 
            tryWrite(port, [132]); 
        }
    })

    socket.on('sideBrush', (data) => {
        auxMotorSpeeds(undefined, data.speed, undefined);
    });

    socket.on('vacuumMotor', (data) => {
        auxMotorSpeeds(undefined, undefined, data.speed);
    });

    socket.on('brushMotor', (data) => {
        auxMotorSpeeds(data.speed, undefined, undefined);
    });

    socket.on('easyStart', () => {
        commandLogger.info('Executing easy start sequence');
        // send dock message then start message, kinda janky but might work
        // turns out it does work!!
        tryWrite(port, [143]);
        tryWrite(port, [132]);
        // AIControlLoop.stop()
    });

    socket.on('easyDock', () => {
        commandLogger.info('Executing easy dock command');
        tryWrite(port, [143]);
    });

    
});