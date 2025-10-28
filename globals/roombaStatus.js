// roombaStatus.js
const roombaStatus = {
    docked: null,
    chargeStatus: null,
    batteryVoltage: 16000,
    batteryFilteredVoltage: 16000,
    batteryCharge: 1946,
    batteryCapacity: 2068,
    batteryPercentage: 100,
    batteryDisplayPercentage: 50,
    bumpSensors: {
        bumpLeft: 'OFF',
        bumpRight: 'OFF'
    },
    lightBumps: {
        LBL: 34,
        LBFL: 37,
        LBCL: 29,
        LBCR: 36,
        LBFR: 30,
        LBR: 33
    },
    overcurrents: {
        leftWheel: 'OFF',
        rightWheel: 'OFF',
        mainBrush: 'OFF',
        sideBrush: 'OFF'
    },
    lastDriveCommandAt: 0
};

module.exports = roombaStatus;
