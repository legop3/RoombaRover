var config = require('./config.json')
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

module.exports = {
  enablePublicMode,
  disablePublicMode,
  isPublicMode
};
