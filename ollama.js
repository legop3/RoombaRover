/* eslint-disable no-console */
const { driveDirect, playRoombaSong, RoombaController } = require('./roombaCommands');
const { port } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const roombaStatus = require('./roombaStatus');
const { Ollama } = require('ollama');

// ==========================
// External Ollama client
// ==========================
const ollama = new Ollama({
  host: `${config.ollama.serverURL}:${config.ollama.serverPort}`,
});

// ==========================
// Controller
// ==========================
const controller = new RoombaController(port);

// ==========================
// Safe prompt reads
// ==========================
function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch { return ''; }
}
const chatPrompt = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');

// ==========================
// Loop & perf state
// ==========================
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// Action queue (executed at high cadence)
const actQueue = [];
let executorTimer = null;

// Planner state
let plannerInFlight = false;
let lastPlanAt = 0;              // ms timestamp
let plansSinceLastKeyframe = 0;  // count since last image plan

// Tiny rolling memory fed back to the model
const shortMemory = [];
const MAX_MEMORY = 8;

// ==========================
// Tunables (speed knobs)
// ==========================
// Fire an action from the local queue every X ms
const ACT_CADENCE_MS = 250;

// Ask the model to return up to N actions per plan (we enforce)
const MAX_ACTIONS_PER_PLAN = 4;

// Only send a camera image every N plans (others are sensor+memory only)
const KEYFRAME_INTERVAL = 3;

// If confidence < this, the next plan forces a keyframe
const LOW_CONFIDENCE = 0.4;

// Replan immediately on bump
const REPLAN_ON_BUMP = true;

// Keep responses short (token budget hint)
const NUM_PREDICT = 120;

// Prefer text markers; JSON mode can be enabled via config if supported by your Ollama build
const USE_JSON_FORMAT = Boolean(config.ollama?.parameters?.use_json_format ?? false);

// ==========================
/* Parameters (kept compatible) */
const defaultParams = {
  temperature: config.ollama?.parameters?.temperature ?? 0.3,
  top_k: config.ollama?.parameters?.top_k ?? 40,
  top_p: config.ollama?.parameters?.top_p ?? 0.9,
  min_k: config.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

// ==========================
// Prompt builders
// ==========================
function buildSystemPrompt(useJsonFormat) {
  if (useJsonFormat) {
    // Compact JSON-only schema (if supported by your Ollama)
    return (
      systemPromptBase +
      '\n\n' +
      'ROLE: Egocentric low-level navigation. Respond with STRICT VALID JSON ONLY.\n' +
      '{\n' +
      '  "state": {\n' +
      '    "free_heading_deg": number,\n' +
      '    "hazard": number,\n' +
      '    "confidence": number,\n' +
      '    "notes": "short"\n' +
      '  },\n' +
      '  "act": ["[left 10]", "[forward 120]"],\n' +
      '  "critic": {"ok_to_move": true}\n' +
      '}\n' +
      'ACTION SET: [forward mm(20-300)] [backward mm(20-300)] [left deg(5-45)] [right deg(5-45)] [say text] [new_goal text]\n' +
      `Return at most ${MAX_ACTIONS_PER_PLAN} actions in "act". No prose.`
    );
  }

  // Ultra-compact marker mode (robust, fast)
  return (
    systemPromptBase +
    '\n\n' +
    'ROLE: Egocentric low-level navigation.\n' +
    'Output three sections in order and keep them SHORT:\n' +
    '[[STATE]] {"free_heading_deg": number, "hazard": number, "confidence": number}\n' +
    `[[ACT]] up to ${MAX_ACTIONS_PER_PLAN} actions from ACTION SET\n` +
    '[[CRITIC]] {"ok_to_move": true|false}\n' +
    'ACTION SET: [forward mm(20-300)] [backward mm(20-300)] [left deg(5-45)] [right deg(5-45)] [say text] [new_goal text]\n' +
    'No commands before [[ACT]]. Keep everything minimal.'
  );
}

function buildUserPrompt(withImage) {
  const bumpLeft = roombaStatus?.bumpSensors?.bumpLeft ?? false;
  const bumpRight = roombaStatus?.bumpSensors?.bumpRight ?? false;

  const lb = roombaStatus?.lightBumps || {};
  const lightStr = [
    `LBL:${lb.LBL ?? 0}`,
    `LBFL:${lb.LBFL ?? 0}`,
    `LBCL:${lb.LBCL ?? 0}`,
    `LBCR:${lb.LBCR ?? 0}`,
    `LBFR:${lb.LBFR ?? 0}`,
    `LBR:${lb.LBR ?? 0}`,
  ].join(' ');

  const goal = currentGoal || 'Explore safely; rotate when unsure.';
  const lastCmd = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';
  const mem = shortMemory.join(' | ');

  const structured =
    `iter:${iterationCount} last:${lastCmd} goal:${goal}\n` +
    `bumpL:${bumpLeft} bumpR:${bumpRight} light:${lightStr}\n` +
    `mem:${mem || 'none'}\n` +
    `Rules: small steps; if conf<${LOW_CONFIDENCE}, rotate small; <=${MAX_ACTIONS_PER_PLAN} actions.\n\n` +
    chatPrompt;

  const msg = { role: 'user', content: structured };

  if (withImage) {
    const frame = getLatestFrontFrameSafe();
    if (frame && frame.length > 0) {
      const clean = frame.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      msg.images = [clean];
    }
  }

  return msg;
}

// ==========================
// Helpers
// ==========================
function getLatestFrontFrameSafe() {
  try { return getLatestFrontFrame(); }
  catch { return null; }
}
function extractJSON(text = '') {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
function safeParseJSON(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function compressStateForMemory(state) {
  try {
    const conf = typeof state.confidence === 'number' ? state.confidence.toFixed(2) : 'na';
    const fh = typeof state.free_heading_deg === 'number' ? Math.round(state.free_heading_deg) : 'na';
    return `conf:${conf} free:${fh}`;
  } catch { return null; }
}

// ==========================
// Command parsing & execution
// ==========================
function parseCommandsFromBuffer(buffer = '') {
  const commands = [];
  const re = /\[(forward|backward|left|right|say|new_goal) ([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(buffer)) !== null) {
    const action = m[1].toLowerCase();
    let value = String(m[2] || '').trim();

    // sanitize numeric ranges
    if (action === 'forward' || action === 'backward') {
      const mm = clamp(parseFloat(value), 20, 300);
      if (!Number.isFinite(mm)) continue;
      value = String(Math.round(mm));
    } else if (action === 'left' || action === 'right') {
      const deg = clamp(parseFloat(value), 5, 45);
      if (!Number.isFinite(deg)) continue;
      value = String(Math.round(deg));
    }

    commands.push({ action, value, fullMatch: m[0] });
    if (commands.length >= MAX_ACTIONS_PER_PLAN) break;
  }
  return commands;
}

function enqueueCommands(commands) {
  for (const c of commands) actQueue.push(c);
}

function executeOne(cmd) {
  if (!cmd) return;
  lastCommand = cmd;
  AIControlLoop.emit('commandExecuted', cmd);
  switch (cmd.action) {
    case 'forward': {
      const mm = parseFloat(cmd.value);
      if (Number.isFinite(mm)) controller.move(mm, 0);
      break;
    }
    case 'backward': {
      const mm = parseFloat(cmd.value);
      if (Number.isFinite(mm)) controller.move(-mm, 0);
      break;
    }
    case 'left': {
      const deg = parseFloat(cmd.value);
      if (Number.isFinite(deg)) controller.move(0, deg);
      break;
    }
    case 'right': {
      const deg = parseFloat(cmd.value);
      if (Number.isFinite(deg)) controller.move(0, -deg);
      break;
    }
    case 'say': {
      const sentence = String(cmd.value || '').trim();
      if (sentence) speak(sentence);
      break;
    }
    case 'new_goal': {
      const goalText = String(cmd.value || '').trim();
      if (goalText) { currentGoal = goalText; AIControlLoop.emit('goalSet', goalText); }
      break;
    }
    default:
      break;
  }
}

// Speech queue (flite)
const speechQueue = [];
let isSpeaking = false;
function speak(text) {
  speechQueue.push(text);
  processSpeechQueue();
}
function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  const fl = spawn('flite', ['-voice', 'rms', '-t', String(text)]);
  isSpeaking = true;
  const done = () => { isSpeaking = false; processSpeechQueue(); };
  fl.on('close', done); fl.on('exit', done); fl.on('error', done);
}

// ==========================
/** One-shot plan request (non-streaming, compact) */
// ==========================
async function requestPlan(withImage) {
  const systemPrompt = buildSystemPrompt(USE_JSON_FORMAT);
  const userMsg = buildUserPrompt(withImage);

  const options = {
    temperature: movingParams.temperature,
    top_k: movingParams.top_k,
    top_p: movingParams.top_p,
    min_k: movingParams.min_k,
    num_predict: NUM_PREDICT,
  };
  if (USE_JSON_FORMAT) options.format = 'json'; // only if explicitly enabled

  const resp = await ollama.chat({
    model: config.ollama.modelName,
    messages: [{ role: 'system', content: systemPrompt }, userMsg],
    stream: false,           // faster + simpler parsing
    keep_alive: -1,
    options,
  });

  const full = String(resp?.message?.content || '').trim();
  // Keep existing UI behavior
  AIControlLoop.emit('streamChunk', full);
  AIControlLoop.emit('responseComplete', full);
  lastResponse = full;

  // Try JSON first (if enabled and valid)
  if (USE_JSON_FORMAT) {
    const obj = safeParseJSON(full);
    if (obj && obj.act) {
      if (obj.state) {
        const mem = compressStateForMemory(obj.state);
        if (mem) {
          shortMemory.push(mem);
          while (shortMemory.length > MAX_MEMORY) shortMemory.shift();
        }
      }
      const actText = Array.isArray(obj.act) ? obj.act.join(' ') : String(obj.act || '');
      return parseCommandsFromBuffer(actText);
    }
  }

  // Marker fallback
  let actRegion = '';
  const lines = full.split(/\r?\n/);
  let mode = null;
  for (const ln of lines) {
    if (ln.includes('[[STATE]]')) { mode = 'state'; continue; }
    if (ln.includes('[[ACT]]'))   { mode = 'act';   continue; }
    if (ln.includes('[[CRITIC]]')){ mode = 'critic';continue; }
    if (mode === 'act') actRegion += ln + '\n';
  }

  // If markers not provided, parse everywhere as a last resort
  const textToParse = actRegion || full;
  return parseCommandsFromBuffer(textToParse);
}

// ==========================
// Fast executor (actions every ACT_CADENCE_MS)
// ==========================
function startExecutor() {
  if (executorTimer) return;
  executorTimer = setInterval(() => {
    if (!loopRunning) return;

    // Bump? Stop and replan instantly.
    if (REPLAN_ON_BUMP && (roombaStatus?.bumpSensors?.bumpLeft || roombaStatus?.bumpSensors?.bumpRight)) {
      actQueue.length = 0;
      schedulePlan(true); // force keyframe
      return;
    }

    const cmd = actQueue.shift();
    if (cmd) executeOne(cmd);
  }, ACT_CADENCE_MS);
}
function stopExecutor() {
  if (executorTimer) { clearInterval(executorTimer); executorTimer = null; }
}

// ==========================
// Planner scheduler (keeps queue topped up)
// ==========================
function schedulePlan(forceKeyframe = false) {
  if (!loopRunning || plannerInFlight) return;

  plannerInFlight = true;

  const needImage = forceKeyframe || plansSinceLastKeyframe >= (KEYFRAME_INTERVAL - 1);

  (async () => {
    try {
      const commands = await requestPlan(needImage);
      lastPlanAt = Date.now();
      plansSinceLastKeyframe = needImage ? 0 : (plansSinceLastKeyframe + 1);
      if (Array.isArray(commands) && commands.length > 0) enqueueCommands(commands);
    } catch (err) {
      console.error('Planner error:', err);
      AIControlLoop.emit('streamError', err);
    } finally {
      plannerInFlight = false;
    }
  })();
}

// ==========================
// Legacy API: keep for server.js compatibility
// ==========================
async function streamChatFromCameraImage(cameraImageBase64) {
  try {
    // If an image is provided, do a one-shot plan immediately
    const commands = await requestPlan(Boolean(cameraImageBase64 && cameraImageBase64.length));
    if (commands?.length) enqueueCommands(commands);
  } catch (e) {
    console.error('streamChatFromCameraImage error:', e);
    AIControlLoop.emit('streamError', e);
    throw e;
  }
}

// ==========================
// Control loop
// ==========================
class AIControlLoopClass extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this._tickTimer = null;
  }

  async start() {
    if (this.isRunning) {
      console.log('Robot control loop is already running.');
      return;
    }
    this.isRunning = true;
    loopRunning = true;
    iterationCount = 0;
    lastPlanAt = 0;
    plansSinceLastKeyframe = 0;
    actQueue.length = 0;

    this.emit('aiModeStatus', true);
    startExecutor();

    // Kick an immediate keyframe plan
    schedulePlan(true);

    // Lightweight scheduler to keep plans coming
    const TICK_MS = 200;
    this._tickTimer = setInterval(async () => {
      if (!this.isRunning) return;
      iterationCount++;
      this.emit('controlLoopIteration', { iterationCount, status: 'tick' });

      // If queue is getting low, top it up
      if (actQueue.length < Math.ceil(MAX_ACTIONS_PER_PLAN / 2)) {
        schedulePlan(false);
      }

      // If it's been a while with no plan, try again
      if (Date.now() - lastPlanAt > 3500) {
        schedulePlan(false);
      }
    }, TICK_MS);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    loopRunning = false;
    this.emit('aiModeStatus', false);
    lastResponse = '';
    actQueue.length = 0;
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
    stopExecutor();
    console.log('Robot control loop stopped.');
  }
}

const AIControlLoop = new AIControlLoopClass();

// ==========================
// Goal & params (API kept)
// ==========================
async function setGoal(goal) {
  currentGoal = goal;
  AIControlLoop.emit('goalSet', goal);
}
function setParams(params) {
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined) movingParams.top_k = params.top_k;
  if (params.top_p !== undefined) movingParams.top_p = params.top_p;
  if (params.min_k !== undefined) movingParams.min_k = params.min_k;
}
function getParams() { return { ...movingParams }; }

// ==========================
// Exports (unchanged shape)
// ==========================
module.exports = {
  streamChatFromCameraImage,
  AIControlLoop,
  speak,
  runCommands: enqueueCommands, // alias: keep old name if server.js uses it
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; AIControlLoop.emit('goalCleared'); },
  setParams,
  getParams,
};
