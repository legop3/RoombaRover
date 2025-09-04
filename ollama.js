const { driveDirect, playRoombaSong, RoombaController } = require('./roombaCommands');
const { port } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const roombaStatus = require('./roombaStatus');
const { Ollama } = require('ollama');

// ============================================================
//  OLLAMA-ONLY, DROP-IN REWRITE (Policy + State + Critic)
//  - preserves the public API and events expected by server.js
//  - pushes all heavy reasoning to the external Ollama server
//  - improves spatial grounding via structured STATE → ACT → CRITIC
//  - micro-action policy with explicit uncertainty handling
// ============================================================

// ==== External Ollama client ====
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });

// ==== Motion controller ====
const controller = new RoombaController(port);

// ==== Prompts (kept) ====
const chatPrompt = fs.readFileSync('./prompts/chat.txt', 'utf8').trim();
const systemPromptBase = fs.readFileSync('./prompts/system.txt', 'utf8').trim();

// ==== Loop state ====
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// A tiny rolling memory the model can reference (all reasoning still remote)
const shortMemory = [];// holds last few compressed STATE lines
const MAX_MEMORY = 8;

// Parameters
const defaultParams = {
  temperature: config.ollama.parameters.temperature ?? 0.6,
  top_k: config.ollama.parameters.top_k ?? 40,
  top_p: config.ollama.parameters.top_p ?? 0.9,
  min_k: config.ollama.parameters.min_k ?? 1,
};
let movingParams = { ...defaultParams };

// ============================================================
// Prompts
// ============================================================
function buildSystemPrompt() {
  return (
    systemPromptBase +
    `

ROLE: You are a low-level navigation policy for a small rover. ` +
    `Work EGOCENTRICALLY (relative to the forward camera). Do not assume a global map.` +
    `

INPUTS you receive each step:` +
    `
- One RGB frame (single image) from the forward camera.` +
    `
- Binary bump sensors (left/right) and light-bump magnitudes.` +
    `
- A short rolling memory (summaries of prior observations).` +
    `
- A goal string set by the user or system.` +
    `

WHAT YOU MUST DO:` +
    `
1) Infer a coarse egocentric situation as JSON in a [[STATE]] block.` +
    `
2) Emit up to three micro-actions from the LIMITED ACTION SET in a [[ACT]] block.` +
    `
3) Self-critique risk/uncertainty in a [[CRITIC]] block.` +
    `

ACTION SET (the ONLY allowed commands; one per bracket):` +
    `
- [forward <mm>]   range 20–300` +
    `
- [backward <mm>]  range 20–300` +
    `
- [left <deg>]     range 5–45  (positive = CCW)` +
    `
- [right <deg>]    range 5–45  (positive = CW)` +
    `
- [say <short>]    optional short status speech` +
    `
- [new_goal <text>] optional goal refinement` +
    `
No other verbs are allowed.` +
    `

SAFETY:` +
    `
- If ANY bump sensor is ON, first back up a small amount or rotate away.` +
    `
- Prefer small rotations to improve view when uncertain.` +
    `
- Keep moves short; we will recheck after every step.` +
    `

FORMATTING (strict):` +
    `
- Start with short optional reasoning (<= 2 sentences).` +
    `
- Then print EXACTLY these three sections in order:` +
    `
[[STATE]]` +
    `
{` +
    `
  "grid": [[-1..1 risk levels in 3x3 left→right, near→far]],` +
    `
  "free_heading_deg": <number>,` +
    `
  "hazard": 0..1,` +
    `
  "confidence": 0..1,` +
    `
  "notes": "1-2 short phrases"` +
    `
}` +
    `
[[ACT]]` +
    `
[one or more bracketed commands from the ACTION SET, max 3]` +
    `
[[CRITIC]]` +
    `
{ "reasons": ["..."], "risk_factors": ["..."], "ok_to_move": true|false }` +
    `
- Do not output any commands before [[ACT]].`
  );
}

function buildUserPrompt(cameraImageBase64) {
  const bumpLeft = roombaStatus.bumpSensors?.bumpLeft;
  const bumpRight = roombaStatus.bumpSensors?.bumpRight;
  const light = roombaStatus.lightBumps || {};
  const lightStr = [
    `LBL:${light.LBL ?? 0}`,
    `LBFL:${light.LBFL ?? 0}`,
    `LBCL:${light.LBCL ?? 0}`,
    `LBCR:${light.LBCR ?? 0}`,
    `LBFR:${light.LBFR ?? 0}`,
    `LBR:${light.LBR ?? 0}`,
  ].join(' ');

  const goal = currentGoal || 'Explore safely and improve view.';
  const lastCmd = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';

  const mem = shortMemory.join(' | ');

  const structured = `
` +
    `iteration: ${iterationCount}
` +
    `last_command: ${lastCmd}
` +
    `current_goal: ${goal}
` +
    `bump_left: ${bumpLeft}
` +
    `bump_right: ${bumpRight}
` +
    `light_bumps: ${lightStr}
` +
    `rolling_memory: ${mem || 'none'}
` +
    `
GUIDANCE:
` +
    `- If confidence < 0.4, prefer small left/right rotations to scan.
` +
    `- Keep forward/backward short unless central near grid is low risk.
` +
    `- Max 3 commands.

` +
    chatPrompt;

  const userMessage = { role: 'user', content: structured };
  if (cameraImageBase64 && cameraImageBase64.length > 0) {
    const cleanBase64 = cameraImageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    userMessage.images = [cleanBase64];
  }
  return userMessage;
}

// ============================================================
// Streaming call with gated parsing of [[STATE]] / [[ACT]] / [[CRITIC]]
// ============================================================
async function streamChatFromCameraImage(cameraImageBase64) {
  const userMsg = buildUserPrompt(cameraImageBase64);
  const systemPrompt = buildSystemPrompt();

  try {
    const response = await ollama.chat({
      model: config.ollama.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        userMsg,
      ],
      stream: true,
      keep_alive: -1,
      options: {
        temperature: movingParams.temperature,
        top_k: movingParams.top_k,
        top_p: movingParams.top_p,
        min_k: movingParams.min_k,
      },
    });

    let full = '';
    let region = { state: '', act: '', critic: '' };
    let inState = false, inAct = false, inCritic = false;

    for await (const part of response) {
      const chunk = part?.message?.content || '';
      if (!chunk) continue;
      full += chunk;
      AIControlLoop.emit('streamChunk', chunk); // keep UI behavior

      // Lightweight state machine to capture regions
      // Start markers
      if (!inState && full.includes('[[STATE]]')) {
        inState = true;
        const idx = full.indexOf('[[STATE]]') + 9;
        region.state += full.slice(idx);
        continue;
      }
      if (inState && !inAct) {
        const idx = region.state.indexOf('[[ACT]]');
        if (idx !== -1) {
          // Split and move on
          const pre = region.state.slice(0, idx);
          region.state = pre;
          inAct = true;
          region.act += region.state.slice(idx + 0); // safety no-op
        }
      }
      if (inState && !inAct && chunk) region.state += chunk;

      if (!inAct && full.includes('[[ACT]]')) {
        inAct = true;
        const idx = full.indexOf('[[ACT]]') + 7;
        region.act += full.slice(idx);
        continue;
      }
      if (inAct && !inCritic) {
        const idx = region.act.indexOf('[[CRITIC]]');
        if (idx !== -1) {
          const pre = region.act.slice(0, idx);
          region.act = pre;
          inCritic = true;
          region.critic += region.act.slice(idx + 0); // safety no-op
        }
      }
      if (inAct && !inCritic && chunk) region.act += chunk;

      if (!inCritic && full.includes('[[CRITIC]]')) {
        inCritic = true;
        const idx = full.indexOf('[[CRITIC]]') + 10;
        region.critic += full.slice(idx);
        continue;
      }
      if (inCritic && chunk) region.critic += chunk;
    }

    // Clean up regions by trimming any trailing markers/noise
    const stateObj = safeParseJSON(extractJSON(region.state));
    const criticObj = safeParseJSON(extractJSON(region.critic));

    // Update short memory with compressed summary if present
    if (stateObj) {
      const memLine = compressStateForMemory(stateObj);
      if (memLine) {
        shortMemory.push(memLine);
        while (shortMemory.length > MAX_MEMORY) shortMemory.shift();
      }
    }

    // Parse and run commands from the ACT region
    const commands = parseCommandsFromBuffer(region.act);
    if (commands.length > 0) {
      runCommands(commands);
      commands.forEach((cmd) => AIControlLoop.emit('commandExecuted', cmd));
    }

    AIControlLoop.emit('responseComplete', full);
    lastResponse = full;
    return full;
  } catch (error) {
    console.error('Error in streaming chat:', error);
    AIControlLoop.emit('streamError', error);
    throw error;
  }
}

// Extract the first JSON-looking {...} block from text
function extractJSON(text = '') {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function safeParseJSON(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function compressStateForMemory(state) {
  try {
    const haz = typeof state.hazard === 'number' ? state.hazard.toFixed(2) : 'na';
    const conf = typeof state.confidence === 'number' ? state.confidence.toFixed(2) : 'na';
    const fh = typeof state.free_heading_deg === 'number' ? Math.round(state.free_heading_deg) : 'na';
    return `haz:${haz} conf:${conf} free:${fh}`;
  } catch { return null; }
}

// ============================================================
// Command parsing & execution
// ============================================================
function parseCommandsFromBuffer(buffer = '') {
  const commands = [];
  const commandRegex = /\[(forward|backward|left|right|say|new_goal) ([^\]]+)\]/gi;
  let match;
  while ((match = commandRegex.exec(buffer)) !== null) {
    const action = match[1];
    const raw = match[2];
    commands.push({ action, value: raw, fullMatch: match[0] });
  }
  return commands;
}

// Speech queue (kept lightweight)
const speechQueue = [];
let isSpeaking = false;
function speak(text) {
  speechQueue.push(text);
  processSpeechQueue();
}
function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  const fl = spawn('flite', ['-voice', 'rms', '-t', `"${text}"`]);
  isSpeaking = true;
  const done = () => { isSpeaking = false; processSpeechQueue(); };
  fl.on('close', done); fl.on('exit', done); fl.on('error', done);
}

function runCommands(commands) {
  commands.forEach((command) => {
    command.action = String(command.action || '').toLowerCase();
    if (!loopRunning) { console.log('loop not running, skipping'); return; }

    lastCommand = command;
    console.log('Executing:', lastCommand);

    switch (command.action) {
      case 'forward': {
        const mm = parseFloat(command.value);
        if (!isNaN(mm)) controller.move(mm, 0);
        else console.error('Invalid forward value:', command.value);
        break;
      }
      case 'backward': {
        const mm = parseFloat(command.value);
        if (!isNaN(mm)) controller.move(-mm, 0);
        else console.error('Invalid backward value:', command.value);
        break;
      }
      case 'left': {
        const deg = parseFloat(command.value);
        if (!isNaN(deg)) controller.move(0, deg);
        else console.error('Invalid left value:', command.value);
        break;
      }
      case 'right': {
        const deg = parseFloat(command.value);
        if (!isNaN(deg)) controller.move(0, -deg);
        else console.error('Invalid right value:', command.value);
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
        console.error('Unknown command:', command.action);
    }
  });
}

// ============================================================
// Control loop (API preserved)
// ============================================================
class AIControlLoopClass extends EventEmitter {
  constructor() { super(); this.isRunning = false; }

  async start() {
    if (this.isRunning) { console.log('Already running'); return; }
    this.emit('aiModeStatus', true);
    this.isRunning = true; loopRunning = true; iterationCount = 0;

    while (this.isRunning) {
      try {
        iterationCount++;
        this.emit('controlLoopIteration', { iterationCount, status: 'started' });

        let cameraImage;
        try { cameraImage = getLatestFrontFrame(); }
        catch (e) { console.warn('No camera frame this iteration:', e?.message || e); cameraImage = null; }

        try { await streamChatFromCameraImage(cameraImage); }
        catch (e) { console.error('Streaming error:', e); this.emit('streamError', e); }

        // Wait until the roomba queue empties or we timeout (safety)
        await Promise.race([
          new Promise((resolve) => controller.once('roomba:queue-empty', resolve)),
          new Promise((resolve) => setTimeout(resolve, 10000)),
        ]);

        await new Promise((r) => setTimeout(r, 100));
        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
      } catch (err) {
        console.error(`Error in control loop iteration ${iterationCount}:`, err);
        this.emit('controlLoopError', err);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    console.log('Robot control loop stopped.');
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false; loopRunning = false; lastResponse = '';
    this.emit('aiModeStatus', false);
  }
}

const AIControlLoop = new AIControlLoopClass();

// ==== Goal & params (API preserved) ====
async function setGoal(goal) { currentGoal = goal; AIControlLoop.emit('goalSet', goal); }
function setParams(params) {
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined) movingParams.top_k = params.top_k;
  if (params.top_p !== undefined) movingParams.top_p = params.top_p;
  if (params.min_k !== undefined) movingParams.min_k = params.min_k;
}
function getParams() { return { ...movingParams }; }

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
