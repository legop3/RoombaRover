// roombaStatus.js
const roombaStatus = {
    docked: null,
    chargeStatus: null,
    batteryVoltage: 16000,
    bumpSensors: {
        bumpLeft: 'OFF',
        bumpRight: 'OFF'
    },
    lightBumps: {
        LBL: 34,
        LBFL: 38,
        LBCL: 29,
        LBCR: 36,
        LBFR: 30,
        LBR: 33
    }
};

module.exports = roombaStatus;
