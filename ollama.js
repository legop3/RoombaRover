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
// Prompts
// ==========================
const chatPrompt = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch { return ''; }
}

// ==========================
// Loop & perf state
// ==========================
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// Fast executor queue
const actQueue = [];          // array of { action, value, fullMatch }
let plannerInFlight = false;  // a plan request is currently running
let lastPlanAt = 0;           // ms
let plansSinceLastKeyframe = 0;

// Tiny rolling memory (strings) fed back to model
const shortMemory = [];
const MAX_MEMORY = 8;

// ==========================
// Tunables (adjust here)
// ==========================
const USE_JSON_FORMAT = Boolean(config.ollama?.parameters?.use_json_format ?? true);

// How many actions the model may return per plan (we enforce at parse time, too)
const MAX_ACTIONS_PER_PLAN = 5;

// How fast actions are executed locally (lower = faster)
const ACT_CADENCE_MS = 350;

// Only send a camera image every N plans; faster text-only in between
const KEYFRAME_INTERVAL = 3;

// Confidence trigger to force keyframe + replan on next tick
const LOW_CONFIDENCE = 0.4;

// Safety: if we see a bump, clear queue and replan immediately
const REPLAN_ON_BUMP = true;

// Request token budget (client-side) to keep responses short (JSON mode)
const NUM_PREDICT = 200;

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
    return (
      systemPromptBase +
      '\n\n' +
      'ROLE: Low-level navigation policy working EGOCENTRICALLY (camera-forward).\n' +
      'You MUST respond with STRICT, VALID JSON ONLY (no prose, no markdown).\n' +
      '{\n' +
      '  "state": {\n' +
      '    "grid": [[-1..1 risk in 3x3 left→right, near→far]],\n' +
      '    "free_heading_deg": number,\n' +
      '    "hazard": number,\n' +
      '    "confidence": number,\n' +
      '    "notes": "short string"\n' +
      '  },\n' +
      '  "act": ["[left 10]", "[forward 100]"],\n' +
      '  "critic": {"reasons": ["..."], "risk_factors": ["..."], "ok_to_move": true}\n' +
      '}\n' +
      'ACTION SET:\n' +
      '- [forward <mm>] 20–300\n' +
      '- [backward <mm>] 20–300\n' +
      '- [left <deg>] 5–45 (CCW)\n' +
      '- [right <deg>] 5–45 (CW)\n' +
      '- [say <short>] | [new_goal <text>]\n' +
      `Return at most ${MAX_ACTIONS_PER_PLAN} actions in "act".`
    );
  }

  return (
    systemPromptBase +
    '\n\n' +
    'ROLE: Low-level egocentric navigation policy.\n' +
    'Emit exactly three sections in order: [[STATE]] then [[ACT]] then [[CRITIC]].\n' +
    '[[STATE]]\n' +
    '{ "grid": [[-1..1 risk in 3x3]], "free_heading_deg": number, "hazard": number, "confidence": number, "notes": "1-2 short phrases" }\n' +
    '[[ACT]]\n' +
    `[up to ${MAX_ACTIONS_PER_PLAN} bracketed commands from ACTION SET]\n` +
    '[[CRITIC]]\n' +
    '{ "reasons": ["..."], "risk_factors": ["..."], "ok_to_move": true|false }\n' +
    'ACTION SET: [forward mm(20–300)] [backward mm(20–300)] [left deg(5–45)] [right deg(5–45)] [say text] [new_goal text]\n' +
    'Do not print any commands before [[ACT]]. Keep output concise.'
  );
}

function buildUserPrompt(cameraImageBase64) {
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
    `iteration: ${iterationCount}\n` +
    `last_command: ${lastCmd}\n` +
    `current_goal: ${goal}\n` +
    `bump_left: ${bumpLeft}\n` +
    `bump_right: ${bumpRight}\n` +
    `light_bumps: ${lightStr}\n` +
    `rolling_memory: ${mem || 'none'}\n\n` +
    'GUIDANCE:\n' +
    `- Return up to ${MAX_ACTIONS_PER_PLAN} micro-actions.\n` +
    '- If confidence < 0.4, prefer small left/right rotations to scan.\n' +
    '- Keep forward/backward short unless central near grid is low risk.\n\n' +
    chatPrompt;

  const userMessage = { role: 'user', content: structured };

  if (cameraImageBase64 && cameraImageBase64.length > 0) {
    const cleanBase64 = cameraImageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    userMessage.images = [cleanBase64];
  }

  return userMessage;
}

// ==========================
// JSON helpers
// ==========================
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
function compressStateForMemory(state) {
  try {
    const haz = typeof state.hazard === 'number' ? state.hazard.toFixed(2) : 'na';
    const conf = typeof state.confidence === 'number' ? state.confidence.toFixed(2) : 'na';
    const fh = typeof state.free_heading_deg === 'number' ? Math.round(state.free_heading_deg) : 'na';
    return `haz:${haz} conf:${conf} free:${fh}`;
  } catch {
    return null;
  }
}

// ==========================
// Command parsing / execution
// ==========================
function parseCommandsFromBuffer(buffer = '') {
  const commands = [];
  const commandRegex = /\[(forward|backward|left|right|say|new_goal) ([^\]]+)\]/gi;
  let match;
  while ((match = commandRegex.exec(buffer)) !== null) {
    const action = match[1];
    const raw = match[2];
    commands.push({ action, value: raw, fullMatch: match[0] });
  }
  // Enforce max actions
  if (commands.length > MAX_ACTIONS_PER_PLAN) commands.length = MAX_ACTIONS_PER_PLAN;
  return commands;
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

function runCommands(commands) {
  for (const command of commands) {
    command.action = String(command.action || '').toLowerCase();
    if (!loopRunning) { console.log('loop not running, skipping'); return; }
    // queue into local actQueue for fast cadence execution
    actQueue.push(command);
  }
}

// ==========================
// Planner: request a plan
// ==========================
async function requestPlan({ withImage }) {
  const userMsg = buildUserPrompt(withImage ? getLatestFrontFrameSafe() : null);
  const systemPrompt = buildSystemPrompt(USE_JSON_FORMAT);

  const options = {
    temperature: movingParams.temperature,
    top_k: movingParams.top_k,
    top_p: movingParams.top_p,
    min_k: movingParams.min_k,
    num_predict: NUM_PREDICT,
  };
  if (USE_JSON_FORMAT) options.format = 'json';

  // Prefer non-streaming for speed + low overhead
  const resp = await ollama.chat({
    model: config.ollama.modelName,
    messages: [{ role: 'system', content: systemPrompt }, userMsg],
    stream: false,
    keep_alive: -1,
    options,
  });

  const full = String(resp?.message?.content || '').trim();
  AIControlLoop.emit('streamChunk', full); // keep UI compatible (one burst)
  AIControlLoop.emit('responseComplete', full);
  lastResponse = full;

  // Try JSON path
  if (USE_JSON_FORMAT) {
    const obj = safeParseJSON(full);
    if (obj) {
      const state = obj.state || null;
      const actArray = Array.isArray(obj.act) ? obj.act : [];
      const critic = obj.critic || null;

      if (state) {
        const memLine = compressStateForMemory(state);
        if (memLine) {
          shortMemory.push(memLine);
          while (shortMemory.length > MAX_MEMORY) shortMemory.shift();
        }
      }

      const actText = actArray.join(' ');
      const commands = parseCommandsFromBuffer(actText);
      return { commands, state, critic, raw: full };
    }
    // Fallback to marker parse below
  }

  // Marker fallback
  const region = { state: '', act: '', critic: '' };
  let mode = null;
  const lines = full.split(/\r?\n/);
  for (const ln of lines) {
    if (ln.includes('[[STATE]]'))  { mode = 'state';  continue; }
    if (ln.includes('[[ACT]]'))    { mode = 'act';    continue; }
    if (ln.includes('[[CRITIC]]')) { mode = 'critic'; continue; }
    if (mode === 'state')  region.state  += ln + '\n';
    if (mode === 'act')    region.act    += ln + '\n';
    if (mode === 'critic') region.critic += ln + '\n';
  }
  const stateObj = safeParseJSON(extractJSON(region.state));
  if (stateObj) {
    const memLine = compressStateForMemory(stateObj);
    if (memLine) {
      shortMemory.push(memLine);
      while (shortMemory.length > MAX_MEMORY) shortMemory.shift();
    }
  }
  const commands = parseCommandsFromBuffer(region.act);
  return { commands, state: stateObj, critic: safeParseJSON(extractJSON(region.critic)), raw: full };
}

function getLatestFrontFrameSafe() {
  try {
    return getLatestFrontFrame();
  } catch (e) {
    console.warn('No camera frame available for keyframe:', e?.message || e);
    return null;
  }
}

// ==========================
// Fast executor loop (acts)
// ==========================
let executorTimer = null;
function startExecutor() {
  if (executorTimer) return;
  executorTimer = setInterval(() => {
    if (!loopRunning) return;

    // Hazard? Clear and force replan.
    if (REPLAN_ON_BUMP && (roombaStatus?.bumpSensors?.bumpLeft || roombaStatus?.bumpSensors?.bumpRight)) {
      actQueue.length = 0;
      plannerKick(true); // force with image next plan
      return;
    }

    const next = actQueue.shift();
    if (!next) return;

    lastCommand = next;
    AIControlLoop.emit('commandExecuted', next);

    // Execute quickly; controller likely queues internally
    switch (next.action) {
      case 'forward': {
        const mm = parseFloat(next.value);
        if (!isNaN(mm)) controller.move(mm, 0);
        break;
      }
      case 'backward': {
        const mm = parseFloat(next.value);
        if (!isNaN(mm)) controller.move(-mm, 0);
        break;
      }
      case 'left': {
        const deg = parseFloat(next.value);
        if (!isNaN(deg)) controller.move(0, deg);
        break;
      }
      case 'right': {
        const deg = parseFloat(next.value);
        if (!isNaN(deg)) controller.move(0, -deg);
        break;
      }
      case 'say': {
        const sentence = String(next.value || '').trim();
        if (sentence) speak(sentence);
        break;
      }
      case 'new_goal': {
        const goalText = String(next.value || '').trim();
        if (goalText) { currentGoal = goalText; AIControlLoop.emit('goalSet', goalText); }
        break;
      }
      default:
        console.error('Unknown command:', next.action);
    }

  }, ACT_CADENCE_MS);
}

function stopExecutor() {
  if (executorTimer) { clearInterval(executorTimer); executorTimer = null; }
}

// ==========================
// Planner trigger
// ==========================
async function plannerKick(forceKeyframe = false) {
  if (!loopRunning || plannerInFlight) return;

  plannerInFlight = true;

  const sendImage =
    forceKeyframe ||
    plansSinceLastKeyframe >= (KEYFRAME_INTERVAL - 1);

  try {
    const { commands, state, critic } = await requestPlan({ withImage: sendImage });

    plansSinceLastKeyframe = sendImage ? 0 : (plansSinceLastKeyframe + 1);
    lastPlanAt = Date.now();

    if (state && typeof state.confidence === 'number' && state.confidence < LOW_CONFIDENCE) {
      // On low confidence, ensure next plan uses a keyframe
      plansSinceLastKeyframe = KEYFRAME_INTERVAL - 1;
    }

    if (Array.isArray(commands) && commands.length > 0) {
      runCommands(commands);
    }
  } catch (err) {
    console.error('Planner error:', err);
    AIControlLoop.emit('streamError', err);
  } finally {
    plannerInFlight = false;
  }
}

// ==========================
// Legacy export function
// (kept for compatibility)
// ==========================
async function streamChatFromCameraImage(cameraImageBase64) {
  // For compatibility: do a one-shot plan using the provided image
  try {
    const { commands } = await requestPlan({ withImage: Boolean(cameraImageBase64) });
    if (commands?.length) runCommands(commands);
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
  }

  async start() {
    if (this.isRunning) {
      console.log('Robot control loop is already running.');
      return;
    }
    this.emit('aiModeStatus', true);
    this.isRunning = true;
    loopRunning = true;
    iterationCount = 0;
    lastPlanAt = 0;
    plansSinceLastKeyframe = 0;
    actQueue.length = 0;
    startExecutor();

    // Kick an immediate keyframe plan
    await plannerKick(true);

    // Lightweight scheduler to keep plans coming in as needed
    const TICK_MS = 250; // planning oversight tick
    while (this.isRunning) {
      try {
        iterationCount++;
        this.emit('controlLoopIteration', { iterationCount, status: 'tick' });

        // If queue is getting low, top it up
        if (actQueue.length < Math.ceil(MAX_ACTIONS_PER_PLAN / 2)) {
          await plannerKick(false);
        }

        // If it’s been a while since last plan (guard)
        const since = Date.now() - lastPlanAt;
        if (since > 4000) { // 4s without a plan → try again
          await plannerKick(false);
        }

        await sleep(TICK_MS);
      } catch (err) {
        console.error('AI loop tick error:', err);
        this.emit('controlLoopError', err);
        await sleep(250);
      }
    }

    stopExecutor();
    console.log('Robot control loop stopped.');
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    loopRunning = false;
    this.emit('aiModeStatus', false);
    lastResponse = '';
    actQueue.length = 0;
    stopExecutor();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  runCommands,
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; AIControlLoop.emit('goalCleared'); },
  setParams,
  getParams,
};
