let ioInstance = null;

function setServer(io) {
  ioInstance = io;
}

function getServer() {
  if (!ioInstance) {
    throw new Error('socket.io server has not been initialized');
  }
  return ioInstance;
}

module.exports = {
  setServer,
  getServer,
};
