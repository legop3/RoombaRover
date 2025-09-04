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
// Controller
// =========================
const controller = new RoombaController(port);

// =========================
// Safe prompt reads
// =========================
function safeRead(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } }
const chatPrompt = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');

// =========================
// State
// =========================
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// =========================
// Tunables (speed knobs)
// =========================
// Aim for ~1–2s ticks on CPU-only. Keep tokens tiny; one command per tick.
const TICK_INTERVAL_MS = 250;   // scheduler tick; we gate with busy logic below
const MOVE_SETTLE_MS  = 280;    // minimal time between commands (non-blocking feel)
const IMAGE_EVERY_N   = 8;      // send a camera keyframe every N ticks (reduce to 4 if you want more vision)
const NUM_PREDICT     = 32;     // tiny generation budget (one command + newline)
const CMD_MIN_FORWARD = 80;     // clamp ultra-tiny forward steps up to something visible

// =========================
// Parameters (drop-in compatible)
// =========================
const defaultParams = {
  temperature: config.ollama?.parameters?.temperature ?? 0.2,
  top_k:       config.ollama?.parameters?.top_k ?? 40,
  top_p:       config.ollama?.parameters?.top_p ?? 0.9,
  min_k:       config.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

// =========================
// Prompts
// =========================
function buildSystemPrompt() {
  // Ultra-focused: one command per tick, newline, stop. Egocentric.
  return (
    systemPromptBase + '\n\n' +
    'ROLE: You are a real-time egocentric low-level navigation policy.\n' +
    'EACH TICK: Output EXACTLY ONE bracketed command, then a newline, and STOP.\n' +
    'Allowed commands:\n' +
    '- [forward <mm>]  (20–300)\n' +
    '- [backward <mm>] (20–300)\n' +
    '- [left <deg>]    (5–45)\n' +
    '- [right <deg>]   (5–45)\n' +
    '- [say <short>]\n' +
    '- [new_goal <text>] (only if also emitting a movement in the NEXT ticks; do not output only new_goal repeatedly)\n' +
    'EGOCENTRIC RULES:\n' +
    '- Left/Right are relative to the camera view.\n' +
    '- If any bump is ON, prefer small [backward 80–150] or [left|right 10–20] away from contact.\n' +
    '- If center seems clear, prefer [forward 120–200]; when unsure, [left|right 10–20] to scan.\n' +
    'FORMAT: ONE command like [forward 140] then newline. No extra prose.\n'
  );
}

function packLightBumps() {
  const lb = roombaStatus?.lightBumps || {};
  return `LBL:${lb.LBL ?? 0} LBFL:${lb.LBFL ?? 0} LBCL:${lb.LBCL ?? 0} LBCR:${lb.LBCR ?? 0} LBFR:${lb.LBFR ?? 0} LBR:${lb.LBR ?? 0}`;
}

function buildTickUserMessage(includeImage) {
  const bumpLeft  = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpRight = !!(roombaStatus?.bumpSensors?.bumpRight);
  const goal      = currentGoal || 'Explore safely; improve view when uncertain.';
  const lastCmd   = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';
  const lightStr  = packLightBumps();

  const body =
    `TICK ${iterationCount}\n` +
    `goal:${goal}\n` +
    `last:${lastCmd}\n` +
    `bumpL:${bumpLeft} bumpR:${bumpRight}\n` +
    `light:${lightStr}\n` +
    `RULE: Output exactly one command then newline. No extra text.\n` +
    chatPrompt;

  const msg = { role: 'user', content: body };

  if (includeImage) {
    const frame = getLatestFrontFrameSafe();
    if (frame && frame.length > 0) {
      const clean = frame.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      msg.images = [clean];
    }
  }

  return msg;
}

function getLatestFrontFrameSafe() {
  try { return getLatestFrontFrame(); } catch { return null; }
}

// =========================
// Streaming single-tick request
// =========================
async function requestOneCommand(includeImage) {
  const sys = buildSystemPrompt();
  const user = buildTickUserMessage(includeImage);

  // Short streaming; stop at newline to keep latency down.
  const response = await ollama.chat({
    model: config.ollama.modelName,
    messages: [{ role: 'system', content: sys }, user],
    stream: true,
    keep_alive: -1,
    options: {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
      num_predict: NUM_PREDICT,
      stop: ['\n'],
    }
  });

  let full = '';
  let outCmds = [];
  for await (const part of response) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    full += chunk;
    AIControlLoop.emit('streamChunk', chunk);

    // parse live (the response is expected to be one bracketed command)
    const cmds = parseCommandsFromBuffer(full);
    if (cmds.length > 0) {
      outCmds = cmds;
      // We don't break the stream here; stop token will end it quickly anyway.
    }
  }

  AIControlLoop.emit('responseComplete', full);
  lastResponse = full;

  // If no parse yet, one last attempt on full
  if (outCmds.length === 0) outCmds = parseCommandsFromBuffer(full);
  return outCmds.slice(0, 1); // exactly one command per tick
}

// =========================
// Parser & helpers
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

// =========================
/* Command execution: fast, non-blocking feel */
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

  // simple busy gate for smooth cadence
  if (motionBusy) return;
  motionBusy = true;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { motionBusy = false; }, MOVE_SETTLE_MS);

  switch (action) {
    case 'forward': {
      let mm = clamp(parseFloat(command.value), 20, 300);
      if (mm === null) return;
      if (mm < CMD_MIN_FORWARD) mm = CMD_MIN_FORWARD; // avoid tiny 20mm spam
      controller.move(mm, 0);
      break;
    }
    case 'backward': {
      const mm = clamp(parseFloat(command.value), 20, 300);
      if (mm === null) return;
      controller.move(-mm, 0);
      break;
    }
    case 'left': {
      const deg = clamp(parseFloat(command.value), 5, 45);
      if (deg === null) return;
      controller.move(0, deg);
      break;
    }
    case 'right': {
      const deg = clamp(parseFloat(command.value), 5, 45);
      if (deg === null) return;
      controller.move(0, -deg);
      break;
    }
    case 'say': {
      const sentence = String(command.value || '').trim();
      if (sentence) speak(sentence);
      break;
    }
    case 'new_goal': {
      const goalText = String(command.value || '').trim();
      if (goalText) { currentGoal = goalText; AIControlLoop.emit('goalSet', goalText); }
      break;
    }
    default:
      // ignore unknown
      break;
  }
}

// =========================
// Speech (flite)
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
// Public: one-shot stream (kept for compatibility)
// =========================
async function streamChatFromCameraImage(cameraImageBase64) {
  // Use provided image (if any) for this tick only.
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
// AI Control Loop
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

        // Sparse vision: send a keyframe every IMAGE_EVERY_N ticks
        const includeImage = (iterationCount % IMAGE_EVERY_N === 1);

        // Ask the server for a single, short action and execute it ASAP
        const cmds = await requestOneCommand(includeImage);
        if (cmds.length) runCommands(cmds);

        // brief non-blocking wait; do NOT stall for long queue drains
        await sleep(60);
        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
      } catch (err) {
        console.error('Tick error:', err);
        this.emit('streamError', err);
        await sleep(120);
      } finally {
        if (this.isRunning) {
          this._timer = setTimeout(tick, TICK_INTERVAL_MS);
        }
      }
    };

    // kick the first tick
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const AIControlLoop = new AIControlLoopClass();

// =========================
// Goal & params (drop-in)
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
  runCommands,
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; AIControlLoop.emit('goalCleared'); },
  setParams,
  getParams,
};
