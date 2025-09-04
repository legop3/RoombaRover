// ollama.js — Drop-in replacement for your existing file (CommonJS)
// Revised to fix import/ESM issues by talking to Ollama via the HTTP API directly (no SDK).
// Keeps your original API: exports { streamChatFromCameraImage, AIControlLoop, speak, runCommands,
// getCurrentGoal, setGoal, clearGoal, setParams, getParams }

'use strict';

const { driveDirect, playRoombaSong, RoombaController } = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const roombaStatus = require('./roombaStatus');

// -------------------- Config & Client --------------------

const OLLAMA_HOST = (config.ollama && config.ollama.serverURL) ? String(config.ollama.serverURL) : 'http://127.0.0.1';
const OLLAMA_PORT = (config.ollama && config.ollama.serverPort) ? String(config.ollama.serverPort) : '11434';
const OLLAMA_BASE = OLLAMA_HOST.match(/^https?:\/\//) ? `${OLLAMA_HOST}:${OLLAMA_PORT}` : `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;
const OLLAMA_MODEL = (config.ollama && config.ollama.modelName) ? config.ollama.modelName : 'llama3.2:3b-instruct';
const OLLAMA_TIMEOUT_MS = (config.ollama && config.ollama.timeoutMs) ? config.ollama.timeoutMs : 1200;
const OLLAMA_KEEPALIVE = (config.ollama && config.ollama.keepAlive) ? config.ollama.keepAlive : 60;

const controller = new RoombaController(port);
let iterationCount = 0;
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// Optional prompt files (kept for compatibility)
const chatPrompt = fs.existsSync('./prompts/chat.txt') ? fs.readFileSync('./prompts/chat.txt', 'utf8').trim() : '';
const systemPromptTxt = fs.existsSync('./prompts/system.txt') ? fs.readFileSync('./prompts/system.txt', 'utf8').trim() : '';

async function setGoal(goal) {
  currentGoal = goal;
  AIControlLoop.emit('goalSet', goal);
}

const defaultParams = {
  temperature: (config.ollama && config.ollama.parameters && config.ollama.parameters.temperature) ?? 0.3,
  top_k: (config.ollama && config.ollama.parameters && config.ollama.parameters.top_k) ?? 30,
  top_p: (config.ollama && config.ollama.parameters && config.ollama.parameters.top_p) ?? 0.85,
  min_k: (config.ollama && config.ollama.parameters && config.ollama.parameters.min_k) ?? 1,
};
let movingParams = { ...defaultParams };

// -------------------- Planner Constants --------------------

const LIMITS = {
  maxForwardMm: 300,
  maxBackwardMm: 200,
  maxTurnDeg: 25,
  maxSpeedMmps: 250,
  clearanceMm: 200,
  minTurnCooldownMs: 250,
};

const SYSTEM_PLANNER = (
  `You are a motion planner for a small differential-drive robot.
` +
  `Decide ONE action per tick from the provided candidates.
` +
  `Hard rules:
` +
  `- Only pick from candidates by index. Do not invent actions or modify values.
` +
  `- Favor continuing forward if the 2x3 cells ahead are free.
` +
  `- Avoid cliffs at all costs. Keep ~${LIMITS.clearanceMm}mm clearance; if uncertain, choose stop.
` +
  `- Output JSON only, exactly: {"choice": <integer>, "confidence": 0..1}. No extra text.
` +
  (systemPromptTxt ? `
Notes: ${systemPromptTxt}
` : '')
);

// -------------------- Utils --------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function now() { return Date.now(); }

function validatePlannerPick(obj, candidateCount) {
  if (!obj || typeof obj !== 'object') return false;
  const { choice, confidence } = obj;
  if (!Number.isInteger(choice) || choice < 1 || choice > candidateCount) return false;
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) return false;
  return true;
}

function normalizeSensors(s) {
  return {
    bump: {
      left: !!(s && s.bump && s.bump.left) || roombaStatus?.bumpSensors?.bumpLeft === 'ON',
      right: !!(s && s.bump && s.bump.right) || roombaStatus?.bumpSensors?.bumpRight === 'ON',
    },
    cliff: {
      left: !!(s && s.cliff && s.cliff.left) || roombaStatus?.cliffSensors?.left === 'ON',
      front_left: !!(s && s.cliff && s.cliff.front_left) || roombaStatus?.cliffSensors?.frontLeft === 'ON',
      front_right: !!(s && s.cliff && s.cliff.front_right) || roombaStatus?.cliffSensors?.frontRight === 'ON',
      right: !!(s && s.cliff && s.cliff.right) || roombaStatus?.cliffSensors?.right === 'ON',
    },
    lightbump: roombaStatus?.lightBumps || (s && s.lightbump) || null,
  };
}

function minimalOccupancyFromSensors(s) {
  const grid_w = 20, grid_h = 10, cell_size_mm = 50;
  let rows = Array.from({ length: grid_h }, () => '.'.repeat(grid_w));
  const bumpAny = roombaStatus?.bumpSensors?.bumpLeft === 'ON' || roombaStatus?.bumpSensors?.bumpRight === 'ON';
  const cliffFront = roombaStatus?.cliffSensors?.frontLeft === 'ON' || roombaStatus?.cliffSensors?.frontRight === 'ON';
  if (bumpAny || cliffFront) rows[grid_h - 2] = '#'.repeat(grid_w);
  for (let r = 0; r < 4; r++) rows[r] = '?'.repeat(grid_w);
  return { cell_size_mm, grid_w, grid_h, cells: rows.join('
') };
}

function buildObservation() {
  const sensors = normalizeSensors({});
  const occupancy = minimalOccupancyFromSensors(sensors);
  return {
    tick: iterationCount,
    state: {
      heading_deg: roombaStatus?.heading_deg ?? 0,
      odometry_mm: roombaStatus?.odometry_mm ?? 0,
      last_actions: lastCommand ? [lastCommand].slice(-5) : [],
      stuck_ticks: 0,
    },
    occupancy,
    sensors,
    goal: currentGoal || 'explore forward unless blocked; avoid cliffs; keep clearance',
    policy: { clearance_mm: LIMITS.clearanceMm },
  };
}

function buildCandidates(bias) {
  const F = clamp(120, 0, LIMITS.maxForwardMm);
  const B = clamp(100, 0, LIMITS.maxBackwardMm);
  const TURN = clamp(15, 0, LIMITS.maxTurnDeg);
  const SPEED = clamp(150, 0, LIMITS.maxSpeedMmps);
  const base = [
    { action: 'forward', value_mm: F, speed_mmps: SPEED },
    { action: 'left', turn_deg: TURN },
    { action: 'right', turn_deg: TURN },
    { action: 'stop' },
  ];
  if (!bias || bias.preferForward) base.unshift({ action: 'forward', value_mm: Math.min(F, 80), speed_mmps: SPEED });
  return base.map((c, i) => ({ idx: i + 1, ...c }));
}

function guardianOverride(sensors, cmd) {
  const cliffAny = sensors?.cliff?.front_left || sensors?.cliff?.front_right || sensors?.cliff?.left || sensors?.cliff?.right;
  const bumpAny = sensors?.bump?.left || sensors?.bump?.right;
  if (cliffAny) return { action: 'stop', value_mm: 0, reason: 'cliff' };
  if (bumpAny && cmd.action === 'forward') return { action: 'stop', value_mm: 0, reason: 'bump' };
  if (cmd.action === 'forward') {
    cmd.value_mm = clamp(cmd.value_mm ?? 0, 0, LIMITS.maxForwardMm);
    cmd.speed_mmps = clamp(cmd.speed_mmps ?? LIMITS.maxSpeedMmps, 0, LIMITS.maxSpeedMmps);
  } else if (cmd.action === 'backward') {
    cmd.value_mm = clamp(cmd.value_mm ?? 0, 0, LIMITS.maxBackwardMm);
    cmd.speed_mmps = clamp(cmd.speed_mmps ?? LIMITS.maxSpeedMmps, 0, LIMITS.maxSpeedMmps);
  } else if (cmd.action === 'left' || cmd.action === 'right') {
    cmd.turn_deg = clamp(cmd.turn_deg ?? LIMITS.maxTurnDeg, 0, LIMITS.maxTurnDeg);
  }
  return cmd;
}

function candidateToCommand(chosen) {
  switch (chosen.action) {
    case 'forward': return { action: 'forward', value_mm: clamp(chosen.value_mm ?? 0, 0, LIMITS.maxForwardMm), speed_mmps: clamp(chosen.speed_mmps ?? LIMITS.maxSpeedMmps, 0, LIMITS.maxSpeedMmps) };
    case 'backward': return { action: 'backward', value_mm: clamp(chosen.value_mm ?? 0, 0, LIMITS.maxBackwardMm), speed_mmps: clamp(chosen.speed_mmps ?? LIMITS.maxSpeedMmps, 0, LIMITS.maxSpeedMmps) };
    case 'left': return { action: 'left', turn_deg: clamp(chosen.turn_deg ?? LIMITS.maxTurnDeg, 0, LIMITS.maxTurnDeg) };
    case 'right': return { action: 'right', turn_deg: clamp(chosen.turn_deg ?? LIMITS.maxTurnDeg, 0, LIMITS.maxTurnDeg) };
    default: return { action: 'stop' };
  }
}

// -------------------- Minimal Ollama HTTP client --------------------

function postJSON(base, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const full = new url.URL(path, base);
    const isHttps = full.protocol === 'https:';
    const data = Buffer.from(JSON.stringify(body));
    const options = {
      method: 'POST',
      hostname: full.hostname,
      port: full.port,
      path: full.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(text)); }
          catch (e) { reject(new Error(`Bad JSON from Ollama: ${e.message}
${text}`)); }
        } else {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${text}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Ollama request timeout')); });
    req.write(data);
    req.end();
  });
}

async function ollamaChatJSON({ model, system, user, options, timeoutMs }) {
  const body = {
    model,
    stream: false,
    keep_alive: `${OLLAMA_KEEPALIVE}s`,
    messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
    options: { ...options, format: 'json' }
  };
  const res = await postJSON(OLLAMA_BASE, '/api/chat', body, timeoutMs);
  // Ollama returns { message: { role, content }, done: true, ... }
  return res && res.message && res.message.content ? res.message.content : null;
}

// -------------------- Speech queue (kept) --------------------

const speechQueue = [];
let isSpeaking = false;
function speak(text) { speechQueue.push(text); processQueue(); }
function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  isSpeaking = true;
  const text = speechQueue.shift();
  const espeak = spawn('flite', ['-voice', 'rms', '-t', `${JSON.stringify(text)}`]);
  espeak.on('error', (err) => { console.error(`flite error: ${err.message}`); isSpeaking = false; processQueue(); });
  espeak.on('exit', () => { isSpeaking = false; processQueue(); });
}

// -------------------- Command execution (kept) --------------------

function runCommands(commands) {
  commands.forEach(command => {
    switch (command.action) {
      case 'say':
        speak(command.value);
        break;
      case 'new_goal':
        setGoal(command.value);
        break;
      case 'forward': {
        const fwd = parseFloat(command.value);
        if (!isNaN(fwd)) controller.move(fwd, 0); else console.error('Invalid forward');
        break;
      }
      case 'backward': {
        const bwd = parseFloat(command.value);
        if (!isNaN(bwd)) controller.move(-bwd, 0); else console.error('Invalid backward');
        break;
      }
      case 'left': {
        const leftAngle = parseFloat(command.value);
        if (!isNaN(leftAngle)) controller.move(0, leftAngle); else console.error('Invalid left');
        break;
      }
      case 'right': {
        const rightAngle = parseFloat(command.value);
        if (!isNaN(rightAngle)) controller.move(0, -rightAngle); else console.error('Invalid right');
        break;
      }
      case 'stop':
        controller.stop();
        break;
      default:
        console.error(`Unknown command: ${command.action}`);
    }
  });
}

function toCommandList(cmd) {
  switch (cmd.action) {
    case 'forward': return [{ action: 'forward', value: cmd.value_mm }];
    case 'backward': return [{ action: 'backward', value: cmd.value_mm }];
    case 'left': return [{ action: 'left', value: cmd.turn_deg }];
    case 'right': return [{ action: 'right', value: cmd.turn_deg }];
    case 'stop': default: return [{ action: 'stop', value: 0 }];
  }
}

// -------------------- Planner per tick (non-streaming) --------------------

async function streamChatFromCameraImage(_cameraImageBase64) {
  const obs = buildObservation();
  const bias = { preferForward: true };
  const candidates = buildCandidates(bias);
  const userPayload = JSON.stringify({ observation: obs, candidates, notes: chatPrompt || undefined });

  let pickJSON = null;
  try {
    pickJSON = await ollamaChatJSON({
      model: OLLAMA_MODEL,
      system: SYSTEM_PLANNER,
      user: userPayload,
      options: {
        temperature: movingParams.temperature,
        top_p: movingParams.top_p,
        top_k: movingParams.top_k,
        num_ctx: 1024,
      },
      timeoutMs: OLLAMA_TIMEOUT_MS,
    });
  } catch (e) {
    console.error('Planner error:', e && e.message ? e.message : e);
    runCommands([{ action: 'stop' }]);
    return;
  }

  let pick;
  try { pick = JSON.parse(pickJSON); }
  catch { console.error('Bad JSON from model:', pickJSON); runCommands([{ action: 'stop' }]); return; }
  if (!validatePlannerPick(pick, candidates.length)) { console.error('Invalid pick:', pick); runCommands([{ action: 'stop' }]); return; }

  const chosen = candidates[pick.choice - 1];
  let cmd = candidateToCommand(chosen);
  cmd = guardianOverride(obs.sensors, cmd);

  lastCommand = cmd.action;
  const commands = toCommandList(cmd);
  runCommands(commands);
}

// -------------------- AI Control Loop (kept API) --------------------

class AIControlLoopClass extends EventEmitter {
  constructor() { super(); this.isRunning = false; this._lastTurnAt = 0; }

  async start() {
    if (this.isRunning) return;
    this.emit('aiModeStatus', true);
    this.isRunning = true;
    loopRunning = true;
    console.log('AI control loop starting...');

    while (this.isRunning) {
      iterationCount++;
      try {
        this.emit('controlLoopIteration', { iterationCount, status: 'starting' });

        // Camera frame is optional for this planner; we keep the call for compatibility/logging
        let cameraImage = null;
        try { cameraImage = await getLatestFrontFrame(); } catch (e) { /* optional */ }

        await streamChatFromCameraImage(cameraImage);

        // Preserve your original queue-empty gate
        try {
          await Promise.race([
            new Promise((resolve) => controller.once('roomba:queue-empty', resolve)),
            new Promise((resolve) => setTimeout(resolve, 10000))
          ]);
        } catch (queueError) {
          console.error('Error waiting for roomba queue:', queueError);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
      } catch (err) {
        console.error(`Error in control loop iteration ${iterationCount}:`, err);
        this.emit('controlLoopError', err);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log('Robot control loop stopped.');
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.emit('aiModeStatus', false);
    loopRunning = false;
  }
}

const AIControlLoop = new AIControlLoopClass();

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
