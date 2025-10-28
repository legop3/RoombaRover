const { spawn } = require('child_process');
const { createLogger } = require('../helpers/logger');
const { cleanProfanity } = require('../helpers/profanityFilter');

const logger = createLogger('TTS');

// Speech queue management
const speechQueue = [];
let isSpeaking = false;

function speak(text) {
  if (typeof text !== 'string') return;
  const clipped = text.slice(0, 100);
  const sanitized = cleanProfanity(clipped);
  if (!sanitized) return;
  speechQueue.push(sanitized);
  logger.info(`Queued speech: "${sanitized}"`);
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
  const espeak = spawn('flite', ['-voice', 'slt', '-t', `"${text}"`]);
  
  
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
