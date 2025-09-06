// roombaStatus.js
const roombaStatus = {
    docked: null,
    chargeStatus: null,
    batteryVoltage: 16000,
    batteryPercentage: 0,
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
    wheelEncoders: {
        left: 0,
        right: 0
    }
};

module.exports = roombaStatus;
