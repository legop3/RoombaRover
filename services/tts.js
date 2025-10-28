const { spawn } = require('child_process');
const { createLogger } = require('../helpers/logger');
const { cleanProfanity } = require('../helpers/profanityFilter');

const logger = createLogger('TTS');

const DEFAULT_TTS_VOICE = 'slt';

function resolveVoice(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return DEFAULT_TTS_VOICE;
}

// Speech queue management
const speechQueue = [];
let isSpeaking = false;

function speak(text, voice = DEFAULT_TTS_VOICE) {
  if (typeof text !== 'string') return;
  const clipped = text.slice(0, 100);
  const sanitized = cleanProfanity(clipped);
  if (!sanitized) return;
  const chosenVoice = resolveVoice(voice);

  speechQueue.push({ text: sanitized, voice: chosenVoice });
  logger.info(`Queued speech (${chosenVoice}): "${sanitized}"`);
  processQueue();
}

function resetSpeechQueue() {
  speechQueue.length = 0;
  isSpeaking = false;
}

function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  isSpeaking = true;
  const nextItem = speechQueue.shift();
  if (!nextItem) {
    isSpeaking = false;
    return;
  }

  const text = typeof nextItem.text === 'string' ? nextItem.text : '';
  if (!text) {
    isSpeaking = false;
    processQueue();
    return;
  }
  const voice = resolveVoice(nextItem.voice);
  const espeak = spawn('flite', ['-voice', voice, '-t', `"${text}"`]);
  
  
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
  resetSpeechQueue,
  DEFAULT_TTS_VOICE,
  resolveVoice,
};
