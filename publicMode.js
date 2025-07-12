const EventEmitter = require('events');
var config = require('./config.json');

// Create event emitter instance
const publicModeEmitter = new EventEmitter();

// Global variable to store public mode state
let publicMode = !config.accessControl.enabled;

function enablePublicMode() {
    const wasPublicMode = publicMode;
    publicMode = true;
    console.log('🌐 Public mode ENABLED');
    
    // Emit event only if state actually changed
    if (!wasPublicMode) {
        publicModeEmitter.emit('publicModeChanged', { enabled: true, previous: false });
        publicModeEmitter.emit('publicModeEnabled');
    }
}

function disablePublicMode() {
    const wasPublicMode = publicMode;
    publicMode = false;
    console.log('🚫 Public mode DISABLED');
    
    // Emit event only if state actually changed
    if (wasPublicMode) {
        publicModeEmitter.emit('publicModeChanged', { enabled: false, previous: true });
        publicModeEmitter.emit('publicModeDisabled');
    }
}

function isPublicMode() {
    return publicMode;
}

// Global variable to store wheel speeds
// let wheelspeeds = {
//     right: 0,
//     left: 0
// };

// function setWheelSpeeds(rightSpeed, leftSpeed) {
//     wheelspeeds.right = rightSpeed;
//     wheelspeeds.left = leftSpeed;
//     console.log(`Wheel speeds set: Right = ${rightSpeed}, Left = ${leftSpeed}`);
// }

// function getWheelSpeeds() {
//     return wheelspeeds;
// }

module.exports = {
    enablePublicMode,
    disablePublicMode,
    isPublicMode,
    // Expose event emitter for use
    publicModeEvent: publicModeEmitter,
    // setWheelSpeeds,
    // getWheelSpeeds
};