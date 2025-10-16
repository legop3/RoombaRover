const { spawn } = require('child_process');
const { createLogger } = require('../helpers/logger');

const logger = createLogger('TTS');

// Speech queue management
const speechQueue = [];
let isSpeaking = false;

function speak(text) {
  // if text is too long, cut it off
  text = text.slice(0, 50);
  speechQueue.push(text);
  logger.info(`Queued speech: "${text}"`);
  processQueue();
}

function resetSpeechQueue() {
  speechQueue.length = 0;
  isSpeaking = false;
}

function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  isSpeaking = true;
  const text = speechQueue.shift();
  const espeak = spawn('flite', ['-voice', 'rms', '-t', `"${text}"`]);
  
  
  espeak.on('error', (err) => {
    logger.error(`Speech synthesis error: ${err.message}`);
    isSpeaking = false;
    processQueue();
  });
  
  espeak.on('exit', () => {
    isSpeaking = false;
    processQueue();
  });
}

module.exports = { 
  speak,
  resetSpeechQueue
};