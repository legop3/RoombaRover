const EventEmitter = require('events');

const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

module.exports = eventBus;
