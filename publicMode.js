var config = require('./config.json')

//global variable to store public mode state
let publicMode = !config.accessControl.enabled;

function enablePublicMode() {
  publicMode = true;
  console.log('🌐 Public mode ENABLED');
}

function disablePublicMode() {
  publicMode = false;
  console.log('🚫 Public mode DISABLED');
}

function isPublicMode() {
  return publicMode;
}

// global variable to store wheel speeds
// let wheelspeeds = {
//   right: 0,
//   left: 0
// };

// function setWheelSpeeds(rightSpeed, leftSpeed) {
//   wheelspeeds.right = rightSpeed;
//   wheelspeeds.left = leftSpeed;
//   console.log(`Wheel speeds set: Right = ${rightSpeed}, Left = ${leftSpeed}`);
// }

// function getWheelSpeeds() {
//   return wheelspeeds;
// }


module.exports = {
  enablePublicMode,
  disablePublicMode,
  isPublicMode,
  // setWheelSpeeds,
  // getWheelSpeeds
};
