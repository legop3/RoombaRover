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
// Debug controls
// =========================
const DEBUG = true;
const DEBUG_CHUNK_MAX = 160; // cap chunk logging length

function dlog(...args) {
  if (DEBUG) console.log('[OLLAMA]', ...args);
}
function dwarn(...args) {
  console.warn('[OLLAMA]', ...args);
}
function derr(...args) {
  console.error('[OLLAMA]', ...args);
}

// =========================
// External Ollama client
// =========================
const ollama = new Ollama({
  host: `${config?.ollama?.serverURL}:${config?.ollama?.serverPort}`,
});

// =========================
// Controller
// =========================
const controller = new RoombaController(port);

// =========================
// Optional Socket.IO (guarded)
// =========================
let io = null;
try { io = global.io || null; } catch { io = null; }
function safeSocketEmit(event, payload) {
  try { if (io && typeof io.emit === 'function') io.emit(event, payload); } catch { /* ignore */ }
}

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

// Short rolling memory for purposeful behavior
const recentActions = []; // strings like "forward 160"
const recentIntents = []; // strings like "scanning right"
const MAX_MEM_ACTIONS = 5;
const MAX_MEM_INTENTS = 5;

// =========================
// Tunables (keep fast)
// =========================
const TICK_INTERVAL_MS   = 250;
const MOVE_SETTLE_MS     = 250;
const IMAGE_EVERY_N      = 8;
const INTENT_EVERY_N     = 6;
const NUM_PREDICT_CMD    = 32;
const NUM_PREDICT_INTENT = 48;
const CMD_MIN_FORWARD    = 100; // avoid tiny 20mm spam

// =========================
// Parameters (drop-in compatible)
// =========================
const defaultParams = {
  temperature: config?.ollama?.parameters?.temperature ?? 0.2,
  top_k:       config?.ollama?.parameters?.top_k ?? 40,
  top_p:       config?.ollama?.parameters?.top_p ?? 0.9,
  min_k:       config?.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

// =========================
// Prompts
// =========================
function buildSystemPromptCommand() {
  return (
    systemPromptBase + '\n\n' +
    'ROLE: Real-time egocentric low-level navigation policy.\n' +
    'THIS TICK: Output EXACTLY ONE bracketed command, then a newline, and STOP.\n' +
    'Allowed: [forward mm(20–300)] [backward mm(20–300)] [left deg(5–45)] [right deg(5–45)] [say text] [new_goal text]\n' +
    'Egocentric: left/right are in IMAGE SPACE.\n' +
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
      const payload = { ts: Date.now(), bytes: Buffer.byteLength(clean, 'base64'), included: true };
      dlog('Camera keyframe attached', payload);
      AIControlLoop.emit('cameraFrameCaptured', payload);
      safeSocketEmit('cameraFrameCaptured', payload);
    } else {
      const payload = { ts: Date.now(), bytes: 0, included: false };
      dlog('No camera frame available this tick', payload);
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
  try { return getLatestFrontFrame(); } catch (e) { dwarn('getLatestFrontFrame error:', e?.message || e); return null; }
}

// =========================
// Streaming: one quick command per tick (with deep debug)
// =========================
async function requestOneCommand(includeImage) {
  const started = Date.now();
  dlog('---- requestOneCommand ----');
  dlog('tick:', iterationCount, 'includeImage:', includeImage);
  dlog('goal:', currentGoal, 'lastCommand:', lastCommand);
  dlog('bumps:', roombaStatus?.bumpSensors, 'light:', roombaStatus?.lightBumps);

  const response = await ollama.chat({
    model: config?.ollama?.modelName,
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
  let chunkCount = 0;

  for await (const part of response) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    chunkCount++;
    full += chunk;
    AIControlLoop.emit('streamChunk', chunk);

    if (DEBUG) {
      const preview = chunk.replace(/\s+/g, ' ').slice(0, DEBUG_CHUNK_MAX);
      dlog(`chunk#${chunkCount}:`, `"${preview}${chunk.length > DEBUG_CHUNK_MAX ? '…' : ''}"`);
    }

    if (!cmds.length) {
      const parsed = parseCommandsFromBuffer(full);
      if (parsed.length) {
        cmds = parsed.slice(0, 1);
        dlog('parsed command (early):', cmds[0]);
      } else {
        if (DEBUG && /\[[^\]]*$/.test(full) === false) {
          dlog('no command parsed yet; waiting for more tokens');
        }
      }
    }
  }

  AIControlLoop.emit('responseComplete', full);
  lastResponse = full;

  if (!cmds.length) {
    cmds = parseCommandsFromBuffer(full).slice(0, 1);
    if (cmds.length) dlog('parsed command (after stream end):', cmds[0]);
  }

  // Extra diagnostics if still nothing
  if (!cmds.length) {
    dwarn('no executable command parsed from response:', JSON.stringify(full));
  }

  dlog('requestOneCommand latency ms:', Date.now() - started);
  return cmds;
}

// =========================
// Streaming: micro intent/status line (with speech)
// =========================
async function requestIntentLine() {
  const started = Date.now();
  dlog('---- requestIntentLine ---- tick:', iterationCount);

  const response = await ollama.chat({
    model: config?.ollama?.modelName,
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
  let chunkCount = 0;

  for await (const part of response) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    chunkCount++;
    full += chunk;
    AIControlLoop.emit('streamChunk', chunk);
    if (DEBUG) {
      const preview = chunk.replace(/\s+/g, ' ').slice(0, DEBUG_CHUNK_MAX);
      dlog(`intent chunk#${chunkCount}:`, `"${preview}${chunk.length > DEBUG_CHUNK_MAX ? '…' : ''}"`);
    }
  }
  AIControlLoop.emit('responseComplete', full);

  const intentText = (full || '').trim();
  dlog('intent raw:', intentText);
  if (intentText) {
    AIControlLoop.emit('intentUpdate', { ts: Date.now(), text: intentText });
    safeSocketEmit('intentUpdate', { ts: Date.now(), text: intentText });

    const phrase = extractIntentPhrase(intentText);
    if (phrase) {
      pushRecentIntent(phrase);
      dlog('intent phrase:', phrase);
      speak(phrase);
    } else {
      dwarn('could not extract [[INTENT]] phrase from:', intentText);
    }
  }
  dlog('requestIntentLine latency ms:', Date.now() - started);
}

function extractIntentPhrase(text) {
  const m = /\[\[INTENT\]\]\s*(.+)/i.exec(text || '');
  return m ? m[1].trim() : (text || '').replace(/^\s*\[\[|\]\]\s*$/g, '').trim();
}

// =========================
// Parsing & normalization
// =========================
function parseCommandsFromBuffer(text = '') {
  const out = [];
  // Grab bracketed segments, then normalize each
  const br = /\[([^\]]+)\]/g;
  let m;
  while ((m = br.exec(text)) !== null) {
    const raw = m[0];
    const inner = (m[1] || '').trim();

    const norm = normalizeCommand(inner);
    if (norm) {
      out.push({ ...norm, fullMatch: raw });
    } else {
      if (DEBUG) dlog('ignored bracket (unrecognized/invalid):', raw);
    }
  }
  return out;
}

/**
 * Accepts lots of LLM variants and normalizes:
 *  "left 10", "left deg(10)", "left degrees 10", "right 10deg",
 *  "forward 120", "forward mm(120)", "forward 120mm",
 *  "say scanning right", "new_goal follow the wall"
 */
function normalizeCommand(inner) {
  const s = inner.trim();
  // Split verb from the rest (first token = verb)
  const parts = s.split(/\s+/);
  const verbRaw = (parts[0] || '').toLowerCase();
  const rest = s.slice(verbRaw.length).trim();

  // map synonyms if any (currently just the canonical verbs)
  const verb = verbRaw;

  if (!['forward','backward','left','right','say','new_goal'].includes(verb)) {
    if (DEBUG) dlog('normalizeCommand: unknown verb:', verbRaw, 'in', s);
    return null;
  }

  if (verb === 'say' || verb === 'new_goal') {
    if (!rest) return null;
    return { action: verb, value: rest };
  }

  // Extract a numeric value in many formats
  // Patterns like: "deg(10)", "10deg", "10 degrees", "degrees 10"
  //                "mm(120)", "120mm", "120 mm"
  let num = null;

  // parenthesized number e.g., deg(10) / mm(120)
  let m = /[-+]?\d+(\.\d+)?(?=\s*\))/.exec(rest);
  if (m) num = parseFloat(m[0]);

  // plain number somewhere
  if (num === null) {
    m = /[-+]?\d+(\.\d+)?/.exec(rest);
    if (m) num = parseFloat(m[0]);
  }

  // units attached like 120mm or 10deg
  if (num === null) {
    m = /([-+]?\d+(\.\d+)?)(?=\s*(mm|deg|degrees)\b)/i.exec(rest);
    if (m) num = parseFloat(m[1]);
  }

  // If still null, try if formats like "deg 10" or "degrees 10"
  if (num === null) {
    m = /(deg|degree|degrees|mm)\s*([-+]?\d+(\.\d+)?)/i.exec(rest);
    if (m) num = parseFloat(m[2]);
  }

  if (num === null || !Number.isFinite(num)) {
    if (DEBUG) dlog('normalizeCommand: no numeric value parsed in', s);
    return null;
  }

  // Clamp ranges
  if (verb === 'forward' || verb === 'backward') {
    const clamped = clamp(num, 20, 300);
    if (clamped !== num) dlog(`clamp ${verb}:`, num, '->', clamped);
    // force a minimum forward step so it's visible
    const final = (verb === 'forward' && clamped < CMD_MIN_FORWARD) ? CMD_MIN_FORWARD : clamped;
    if (verb === 'forward' && final !== clamped) dlog(`min forward bump:`, clamped, '->', final);
    return { action: verb, value: String(Math.round(final)) };
  } else if (verb === 'left' || verb === 'right') {
    const clamped = clamp(num, 5, 45);
    if (clamped !== num) dlog(`clamp ${verb}:`, num, '->', clamped);
    return { action: verb, value: String(Math.round(clamped)) };
  }

  return null;
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
// Command execution (fast cadence + deep debug)
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
  if (!loopRunning) { dlog('executeOne: loop not running, skipping'); return; }
  const action = String(command.action || '').toLowerCase();
  const valueStr = String(command.value || '').trim();

  // Smooth cadence gate
  if (motionBusy) { dlog('executeOne: motion busy, dropping command', command); return; }
  motionBusy = true;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { motionBusy = false; }, MOVE_SETTLE_MS);

  lastCommand = command;
  dlog('EXECUTE:', action, valueStr);

  switch (action) {
    case 'forward': {
      const mm = parseFloat(valueStr);
      if (!Number.isFinite(mm)) { dwarn('invalid forward value:', valueStr); return; }
      controller.move(mm, 0);
      pushRecentAction(`forward ${Math.round(mm)}`);
      break;
    }
    case 'backward': {
      const mm = parseFloat(valueStr);
      if (!Number.isFinite(mm)) { dwarn('invalid backward value:', valueStr); return; }
      controller.move(-mm, 0);
      pushRecentAction(`backward ${Math.round(mm)}`);
      break;
    }
    case 'left': {
      const deg = parseFloat(valueStr);
      if (!Number.isFinite(deg)) { dwarn('invalid left value:', valueStr); return; }
      controller.move(0, deg);
      pushRecentAction(`left ${Math.round(deg)}`);
      break;
    }
    case 'right': {
      const deg = parseFloat(valueStr);
      if (!Number.isFinite(deg)) { dwarn('invalid right value:', valueStr); return; }
      controller.move(0, -deg);
      pushRecentAction(`right ${Math.round(deg)}`);
      break;
    }
    case 'say': {
      const sentence = valueStr;
      if (sentence) speak(sentence);
      pushRecentAction('say');
      break;
    }
    case 'new_goal': {
      const goalText = valueStr;
      if (goalText) { currentGoal = goalText; AIControlLoop.emit('goalSet', goalText); }
      pushRecentAction('new_goal');
      break;
    }
    default:
      dlog('executeOne: unknown verb', action);
  }
}

// =========================
// Speech (flite)
// =========================
const speechQueue = [];
let isSpeaking = false;
function speak(text) {
  speechQueue.push(String(text));
  processSpeechQueue();
}
function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  dlog('SAY:', text);
  const fl = spawn('flite', ['-voice', 'rms', '-t', text]);
  isSpeaking = true;
  const done = () => { isSpeaking = false; processSpeechQueue(); };
  fl.on('close', done); fl.on('exit', done); fl.on('error', (e) => { derr('flite error:', e?.message || e); done(); });
}

// =========================
// Public one-shot (compat)
// =========================
async function streamChatFromCameraImage(cameraImageBase64) {
  try {
    const includeImage = !!(cameraImageBase64 && cameraImageBase64.length);
    dlog('streamChatFromCameraImage: includeImage:', includeImage, 'imgLen:', cameraImageBase64 ? cameraImageBase64.length : 0);
    const cmds = await requestOneCommand(includeImage);
    if (cmds.length) runCommands(cmds);
    return lastResponse;
  } catch (e) {
    derr('streamChatFromCameraImage error:', e);
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
    if (this.isRunning) { dlog('AI loop already running'); return; }
    this.isRunning = true;
    loopRunning = true;
    iterationCount = 0;
    this.emit('aiModeStatus', true);
    dlog('AI loop START');

    const tick = async () => {
      if (!this.isRunning) return;
      try {
        iterationCount++;
        this.emit('controlLoopIteration', { iterationCount, status: 'started' });

        const includeImage = (iterationCount % IMAGE_EVERY_N === 1);
        dlog(`TICK ${iterationCount} | includeImage=${includeImage} | goal="${currentGoal}"`);
        const t0 = Date.now();
        const cmds = await requestOneCommand(includeImage);
        dlog('tick plan latency ms:', Date.now() - t0, '| cmds:', cmds);

        if (cmds.length) runCommands(cmds);

        // periodic intent/status (fire-and-forget)
        if (iterationCount % INTENT_EVERY_N === 0) {
          requestIntentLine().catch(err => {
            derr('intent request error:', err);
            this.emit('streamError', err);
          });
        }

        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
      } catch (err) {
        derr('Tick error:', err);
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
    dlog('AI loop STOP');
  }
}

const AIControlLoop = new AIControlLoopClass();

// =========================
// Goal & params (drop-in)
// =========================
async function setGoal(goal) {
  currentGoal = goal;
  dlog('setGoal:', goal);
  AIControlLoop.emit('goalSet', goal);
}
function setParams(params) {
  dlog('setParams:', params);
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined)       movingParams.top_k = params.top_k;
  if (params.top_p !== undefined)       movingParams.top_p = params.top_p;
  if (params.min_k !== undefined)       movingParams.min_k = params.min_k;
}
function getParams() { return { ...movingParams }; }

// =========================
// Exports (unchanged shape)
// =========================
module.exports = {
  streamChatFromCameraImage,
  AIControlLoop,
  speak,
  runCommands: (cmds) => runCommands(cmds), // keep the name/shape if server.js calls it
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; dlog('clearGoal'); AIControlLoop.emit('goalCleared'); },
  setParams,
  getParams,
};
