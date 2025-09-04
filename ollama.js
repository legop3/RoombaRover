/* eslint-disable no-console */
const { RoombaController } = require('./roombaCommands');
const { port } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const roombaStatus = require('./roombaStatus');
const { Ollama } = require('ollama');

// =========================
// External Ollama client
// =========================
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });

// =========================
/* Controller */
// =========================
const controller = new RoombaController(port);

// =========================
/* Optional Socket.IO (guarded) */
// =========================
let io = null;
try { io = global.io || null; } catch { io = null; }
function safeSocketEmit(event, payload) {
  try { if (io && typeof io.emit === 'function') io.emit(event, payload); } catch { /* ignore */ }
}

// =========================
/* Safe prompt reads */
// =========================
function safeRead(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } }
const chatPrompt = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');

// =========================
/* State */
// =========================
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// Tiny rolling memory so the model keeps a thread across ticks
const recentActions = []; // e.g., ["forward 160", "right 15"]
const recentIntents = []; // e.g., ["scanning right", "moving toward doorway"]
const MAX_MEM_ACTIONS = 5;
const MAX_MEM_INTENTS = 5;

// =========================
/* Tunables (keep it snappy) */
// =========================
const TICK_INTERVAL_MS   = 250; // scheduler tick
const MOVE_SETTLE_MS     = 250; // min spacing between executed commands
const IMAGE_EVERY_N      = 8;   // attach a camera keyframe every N ticks
const INTENT_EVERY_N     = 6;   // tiny intent/status every N ticks (text-only)
const NUM_PREDICT_CMD    = 32;  // one command + newline
const NUM_PREDICT_INTENT = 48;  // one [[INTENT]] line + newline
const CMD_MIN_FORWARD    = 100; // avoid useless 20mm crawl

// =========================
/* Parameters (drop-in compatible) */
// =========================
const defaultParams = {
  temperature: config.ollama?.parameters?.temperature ?? 0.2,
  top_k:       config.ollama?.parameters?.top_k ?? 40,
  top_p:       config.ollama?.parameters?.top_p ?? 0.9,
  min_k:       config.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

// =========================
/* Prompts */
// =========================
function buildSystemPromptCommand() {
  return (
    systemPromptBase + '\n\n' +
    'ROLE: Real-time egocentric low-level navigation policy.\n' +
    'THIS TICK: Output EXACTLY ONE bracketed command, then a newline, and STOP.\n' +
    'Allowed: [forward mm(20–300)] [backward mm(20–300)] [left deg(5–45)] [right deg(5–45)] [say text] [new_goal text]\n' +
    'Egocentric rules: left/right are in IMAGE SPACE.\n' +
    'If any bump is ON, prefer [backward 80–150] or [left|right 10–20] to clear.\n' +
    'If center is clear, prefer [forward 120–200]; when unsure, [left|right 10–20] to scan.\n' +
    'FORMAT: One command, newline. No extra prose.\n'
  );
}

function buildSystemPromptIntent() {
  return (
    'ROLE: Navigation intent summarizer.\n' +
    'TASK: Using the tick context and short memory, output ONE line starting with [[INTENT]] and a concise purpose, then newline, and STOP.\n' +
    'Examples:\n' +
    '[[INTENT]] scanning right for an opening\n' +
    '[[INTENT]] moving toward brighter corridor ahead\n'
  );
}

function packLightBumps() {
  const lb = roombaStatus?.lightBumps || {};
  return `LBL:${lb.LBL ?? 0} LBFL:${lb.LBFL ?? 0} LBCL:${lb.LBCL ?? 0} LBCR:${lb.LBCR ?? 0} LBFR:${lb.LBFR ?? 0} LBR:${lb.LBR ?? 0}`;
}

function buildMemoryLine() {
  const acts = recentActions.slice(-MAX_MEM_ACTIONS).join(',');
  const ints = recentIntents.slice(-MAX_MEM_INTENTS).join(',');
  return `mem:acts=${acts || 'none'};intents=${ints || 'none'}`;
}

function buildTickUserMessage(includeImage) {
  const bumpLeft  = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpRight = !!(roombaStatus?.bumpSensors?.bumpRight);
  const goal      = currentGoal || 'Explore safely; improve view when uncertain.';
  const lastCmd   = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';
  const lightStr  = packLightBumps();
  const memLine   = buildMemoryLine();

  const body =
    `TICK ${iterationCount}\n` +
    `goal:${goal}\n` +
    `last:${lastCmd}\n` +
    `bumpL:${bumpLeft} bumpR:${bumpRight}\n` +
    `light:${lightStr}\n` +
    `${memLine}\n` +
    'FORMAT: One bracketed command then newline. No other text.\n' +
    chatPrompt;

  const msg = { role: 'user', content: body };

  if (includeImage) {
    const frame = getLatestFrontFrameSafe();
    if (frame && frame.length > 0) {
      const clean = frame.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      msg.images = [clean];

      // Emit camera frame meta for UI + sockets
      const payload = { ts: Date.now(), bytes: Buffer.byteLength(clean, 'base64'), included: true };
      AIControlLoop.emit('cameraFrameCaptured', payload);
      safeSocketEmit('cameraFrameCaptured', payload);
    } else {
      const payload = { ts: Date.now(), bytes: 0, included: false };
      AIControlLoop.emit('cameraFrameCaptured', payload);
      safeSocketEmit('cameraFrameCaptured', payload);
    }
  }
  return msg;
}

function buildIntentUserMessage() {
  const bumpLeft  = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpRight = !!(roombaStatus?.bumpSensors?.bumpRight);
  const goal      = currentGoal || 'Explore safely; improve view when uncertain.';
  const lastCmd   = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';
  const lightStr  = packLightBumps();
  const memLine   = buildMemoryLine();

  return {
    role: 'user',
    content:
      `intent_tick:${iterationCount}\n` +
      `goal:${goal}\n` +
      `last:${lastCmd}\n` +
      `bumpL:${bumpLeft} bumpR:${bumpRight}\n` +
      `light:${lightStr}\n` +
      `${memLine}\n` +
      'Output one line: [[INTENT]] <short purpose>, newline, stop.\n'
  };
}

function getLatestFrontFrameSafe() {
  try { return getLatestFrontFrame(); } catch { return null; }
}

// =========================
/* Streaming: one quick command per tick */
// =========================
async function requestOneCommand(includeImage) {
  const response = await ollama.chat({
    model: config.ollama.modelName,
    messages: [
      { role: 'system', content: buildSystemPromptCommand() },
      buildTickUserMessage(includeImage),
    ],
    stream: true,
    keep_alive: -1,
    options: {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
      num_predict: NUM_PREDICT_CMD,
      stop: ['\n'],
    }
  });

  let full = '';
  let cmds = [];
  for await (const part of response) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    full += chunk;
    AIControlLoop.emit('streamChunk', chunk);
    if (!cmds.length) {
      const parsed = parseCommandsFromBuffer(full);
      if (parsed.length) cmds = parsed.slice(0, 1);
    }
  }
  AIControlLoop.emit('responseComplete', full);
  lastResponse = full;

  if (!cmds.length) cmds = parseCommandsFromBuffer(full).slice(0, 1);
  return cmds;
}

// =========================
/* Streaming: micro intent/status line */
// =========================
async function requestIntentLine() {
  const response = await ollama.chat({
    model: config.ollama.modelName,
    messages: [
      { role: 'system', content: buildSystemPromptIntent() },
      buildIntentUserMessage(),
    ],
    stream: true,
    keep_alive: -1,
    options: {
      temperature: 0.2,
      top_k: 20,
      top_p: 0.8,
      min_k: 1,
      num_predict: NUM_PREDICT_INTENT,
      stop: ['\n'],
    }
  });

  let full = '';
  for await (const part of response) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    full += chunk;
    AIControlLoop.emit('streamChunk', chunk);
  }
  AIControlLoop.emit('responseComplete', full);

  const intentText = (full || '').trim();
  if (intentText) {
    AIControlLoop.emit('intentUpdate', { ts: Date.now(), text: intentText });
    safeSocketEmit('intentUpdate', { ts: Date.now(), text: intentText });

    const phrase = extractIntentPhrase(intentText);
    if (phrase) {
      // remember & speak
      pushRecentIntent(phrase);
      speak(phrase);
    }
  }
}

function extractIntentPhrase(text) {
  const m = /\[\[INTENT\]\]\s*(.+)/i.exec(text || '');
  return m ? m[1].trim() : (text || '').replace(/^\s*\[\[|\]\]\s*$/g, '').trim();
}

// =========================
/* Parsing & helpers */
// =========================
function parseCommandsFromBuffer(text = '') {
  const out = [];
  const re = /\[(forward|backward|left|right|say|new_goal)\s+([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ action: (m[1] || '').toLowerCase(), value: String(m[2] || '').trim(), fullMatch: m[0] });
  }
  return out;
}
function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}
function pushRecentAction(s) {
  if (!s) return;
  recentActions.push(s);
  while (recentActions.length > MAX_MEM_ACTIONS) recentActions.shift();
}
function pushRecentIntent(s) {
  if (!s) return;
  recentIntents.push(s);
  while (recentIntents.length > MAX_MEM_INTENTS) recentIntents.shift();
}

// =========================
/* Command execution (fast cadence) */
// =========================
let motionBusy = false;
let settleTimer = null;

function runCommands(cmds) {
  for (const c of cmds) {
    executeOne(c);
    AIControlLoop.emit('commandExecuted', c);
  }
}

function executeOne(command) {
  if (!loopRunning) return;
  const action = String(command.action || '').toLowerCase();
  lastCommand = command;

  if (motionBusy) return;
  motionBusy = true;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { motionBusy = false; }, MOVE_SETTLE_MS);

  switch (action) {
    case 'forward': {
      let mm = clamp(parseFloat(command.value), 20, 300);
      if (mm === null) return;
      if (mm < CMD_MIN_FORWARD) mm = CMD_MIN_FORWARD;
      controller.move(mm, 0);
      pushRecentAction(`forward ${Math.round(mm)}`);
      break;
    }
    case 'backward': {
      const mm = clamp(parseFloat(command.value), 20, 300);
      if (mm === null) return;
      controller.move(-mm, 0);
      pushRecentAction(`backward ${Math.round(mm)}`);
      break;
    }
    case 'left': {
      const deg = clamp(parseFloat(command.value), 5, 45);
      if (deg === null) return;
      controller.move(0, deg);
      pushRecentAction(`left ${Math.round(deg)}`);
      break;
    }
    case 'right': {
      const deg = clamp(parseFloat(command.value), 5, 45);
      if (deg === null) return;
      controller.move(0, -deg);
      pushRecentAction(`right ${Math.round(deg)}`);
      break;
    }
    case 'say': {
      const sentence = String(command.value || '').trim();
      if (sentence) speak(sentence);
      pushRecentAction('say');
      break;
    }
    case 'new_goal': {
      const goalText = String(command.value || '').trim();
      if (goalText) { currentGoal = goalText; AIControlLoop.emit('goalSet', goalText); }
      pushRecentAction('new_goal');
      break;
    }
    default:
      break;
  }
}

// =========================
/* Speech (flite) */
// =========================
const speechQueue = [];
let isSpeaking = false;
function speak(text) { speechQueue.push(String(text)); processSpeechQueue(); }
function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  const fl = spawn('flite', ['-voice', 'rms', '-t', text]);
  isSpeaking = true;
  const done = () => { isSpeaking = false; processSpeechQueue(); };
  fl.on('close', done); fl.on('exit', done); fl.on('error', done);
}

// =========================
/* Public one-shot (compat) */
// =========================
async function streamChatFromCameraImage(cameraImageBase64) {
  try {
    const includeImage = !!(cameraImageBase64 && cameraImageBase64.length);
    const cmds = await requestOneCommand(includeImage);
    if (cmds.length) runCommands(cmds);
    return lastResponse;
  } catch (e) {
    console.error('streamChatFromCameraImage error:', e);
    AIControlLoop.emit('streamError', e);
    throw e;
  }
}

// =========================
/* AI Control Loop (drop-in) */
// =========================
class AIControlLoopClass extends EventEmitter {
  constructor() { super(); this.isRunning = false; this._timer = null; }

  async start() {
    if (this.isRunning) { console.log('Robot control loop is already running.'); return; }
    this.isRunning = true;
    loopRunning = true;
    iterationCount = 0;
    this.emit('aiModeStatus', true);

    const tick = async () => {
      if (!this.isRunning) return;
      try {
        iterationCount++;
        this.emit('controlLoopIteration', { iterationCount, status: 'started' });

        const includeImage = (iterationCount % IMAGE_EVERY_N === 1);
        const cmds = await requestOneCommand(includeImage);
        if (cmds.length) runCommands(cmds);

        // Periodic tiny intent/status line (text-only), also spoken aloud
        if (iterationCount % INTENT_EVERY_N === 0) {
          requestIntentLine().catch(err => {
            console.error('intent request error:', err);
            this.emit('streamError', err);
          });
        }

        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
      } catch (err) {
        console.error('Tick error:', err);
        this.emit('streamError', err);
      } finally {
        if (this.isRunning) this._timer = setTimeout(tick, TICK_INTERVAL_MS);
      }
    };

    this._timer = setTimeout(tick, 1);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    loopRunning = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.emit('aiModeStatus', false);
    lastResponse = '';
  }
}

const AIControlLoop = new AIControlLoopClass();

// =========================
/* Goal & params (drop-in) */
// =========================
async function setGoal(goal) { currentGoal = goal; AIControlLoop.emit('goalSet', goal); }
function setParams(params) {
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined)       movingParams.top_k = params.top_k;
  if (params.top_p !== undefined)       movingParams.top_p = params.top_p;
  if (params.min_k !== undefined)       movingParams.min_k = params.min_k;
}
function getParams() { return { ...movingParams }; }

// =========================
/* Exports (unchanged shape) */
// =========================
module.exports = {
  streamChatFromCameraImage,
  AIControlLoop,
  speak,
  runCommands: (cmds) => runCommands(cmds), // keep name if server.js calls it
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; AIControlLoop.emit('goalCleared'); },
  setParams,
  getParams,
};
