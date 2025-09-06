// roombaStatus.js
const roombaStatus = {
    docked: null,
    chargeStatus: null,
    batteryVoltage: 16000,
    batteryPercentage: 3000,
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
    // fresh shiny sensors for the rover's brain
    mainBrushCurrent: 0,
    sideBrushCurrent: 0,
    wheelEncoders: {
        left: 0,
        right: 0
    },
    odometry: {
        distance: 0,
        angle: 0,
        x: 0,
        y: 0,
        theta: 0
    }
};

module.exports = roombaStatus;
