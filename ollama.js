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
const chatPrompt = fs.readFileSync('./prompts/chat.txt', 'utf8').trim();
const systemPromptBase = fs.readFileSync('./prompts/system.txt', 'utf8').trim();

// ==========================
// Loop state
// ==========================
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// Tiny rolling memory (strings)
const shortMemory = [];
const MAX_MEMORY = 8;

// ==========================
/* Parameters (kept compatible) */
const defaultParams = {
  temperature: config.ollama?.parameters?.temperature ?? 0.5,
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
    // JSON-only response mode
    return (
      systemPromptBase +
      '\n\n' +
      'ROLE: Low-level navigation policy working EGOCENTRICALLY (camera-forward).\n' +
      'You MUST respond with STRICT, VALID JSON ONLY (no prose, no markdown).\n' +
      'JSON schema (conceptual): {\n' +
      '  "state": {\n' +
      '    "grid": [[-1..1 risk in 3x3 left→right, near→far]],\n' +
      '    "free_heading_deg": number,\n' +
      '    "hazard": number,\n' +
      '    "confidence": number,\n' +
      '    "notes": "short string"\n' +
      '  },\n' +
      '  "act": ["[left 10]", "[forward 100]"],  // up to 3 commands, bracketed strings\n' +
      '  "critic": {"reasons": ["..."], "risk_factors": ["..."], "ok_to_move": true}\n' +
      '}\n' +
      '\n' +
      'ACTION SET (the ONLY allowed verbs inside brackets):\n' +
      '- [forward <mm>]   range 20–300\n' +
      '- [backward <mm>]  range 20–300\n' +
      '- [left <deg>]     range 5–45 (CCW)\n' +
      '- [right <deg>]    range 5–45 (CW)\n' +
      '- [say <short>]\n' +
      '- [new_goal <text>]\n' +
      'At most 3 actions in total.\n' +
      'SAFETY:\n' +
      '- If a bump is ON, back up a small amount or rotate away first.\n' +
      '- Prefer small rotations when confidence < 0.4.\n' +
      'Respond with ONLY JSON. No additional text.'
    );
  }

  // Marker-mode with [[STATE]] / [[ACT]] / [[CRITIC]]
  return (
    systemPromptBase +
    '\n\n' +
    'ROLE: Low-level egocentric navigation policy.\n' +
    'You will emit three sections in order: [[STATE]] then [[ACT]] then [[CRITIC]].\n' +
    '\n' +
    '[[STATE]]\n' +
    '{\n' +
    '  "grid": [[-1..1 risk in 3x3 left→right, near→far]],\n' +
    '  "free_heading_deg": number,\n' +
    '  "hazard": number,\n' +
    '  "confidence": number,\n' +
    '  "notes": "1-2 short phrases"\n' +
    '}\n' +
    '[[ACT]]\n' +
    '[up to three bracketed commands from the ACTION SET]\n' +
    '[[CRITIC]]\n' +
    '{ "reasons": ["..."], "risk_factors": ["..."], "ok_to_move": true|false }\n' +
    '\n' +
    'ACTION SET:\n' +
    '- [forward <mm>]   20–300\n' +
    '- [backward <mm>]  20–300\n' +
    '- [left <deg>]     5–45\n' +
    '- [right <deg>]    5–45\n' +
    '- [say <short>]\n' +
    '- [new_goal <text>]\n' +
    'No other verbs. Do not output any commands before [[ACT]].'
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

  const goal = currentGoal || 'Explore safely, prefer to improve view when uncertain.';
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
    '- If confidence < 0.4, prefer small left/right rotations to scan.\n' +
    '- Keep forward/backward short unless central near grid is low risk.\n' +
    '- Max 3 commands.\n\n' +
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

// ==========================
// Streaming & parsing
// ==========================
async function streamChatFromCameraImage(cameraImageBase64) {
  const useJsonFormat = !!(config.ollama?.parameters?.use_json_format);
  const userMsg = buildUserPrompt(cameraImageBase64);
  const systemPrompt = buildSystemPrompt(useJsonFormat);

  try {
    const options = {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
    };
    if (useJsonFormat) {
      // Ollama JSON mode forces JSON output
      // (If your Ollama doesn't support this, set use_json_format=false)
      options.format = 'json';
    }

    const response = await ollama.chat({
      model: config.ollama.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        userMsg,
      ],
      stream: true,
      keep_alive: -1,
      options,
    });

    let full = '';
    for await (const part of response) {
      const chunk = part?.message?.content || '';
      if (!chunk) continue;
      full += chunk;
      AIControlLoop.emit('streamChunk', chunk);
    }

    // === Preferred: JSON mode ===
    if (useJsonFormat) {
      const obj = safeParseJSON(full.trim());
      if (obj) {
        if (obj.state) {
          const memLine = compressStateForMemory(obj.state);
          if (memLine) {
            shortMemory.push(memLine);
            while (shortMemory.length > MAX_MEMORY) shortMemory.shift();
          }
        }
        const actText = Array.isArray(obj.act) ? obj.act.join(' ') : '';
        const commands = parseCommandsFromBuffer(actText);
        if (commands.length > 0) {
          runCommands(commands);
          commands.forEach((cmd) => AIControlLoop.emit('commandExecuted', cmd));
        }
        AIControlLoop.emit('responseComplete', full);
        lastResponse = full;
        return full;
      }
      // Fall through to marker mode if JSON parse failed
    }

    // === Fallback: marker mode ===
    const region = { state: '', act: '', critic: '' };
    let mode = null; // 'state' | 'act' | 'critic' | null
    const lines = full.split(/\r?\n/);

    for (const ln of lines) {
      if (ln.includes('[[STATE]]')) { mode = 'state'; continue; }
      if (ln.includes('[[ACT]]'))   { mode = 'act';   continue; }
      if (ln.includes('[[CRITIC]]')){ mode = 'critic';continue; }
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

    while (this.isRunning) {
      try {
        iterationCount++;
        this.emit('controlLoopIteration', { iterationCount, status: 'started' });

        // camera frame
        let cameraImage = null;
        try {
          cameraImage = getLatestFrontFrame();
        } catch (e) {
          console.warn('No camera frame available this iteration:', e?.message || e);
        }

        // remote reasoning
        try {
          await streamChatFromCameraImage(cameraImage);
        } catch (e) {
          console.error('Streaming error:', e);
          this.emit('streamError', e);
        }

        // wait for queue drain or timeout
        await Promise.race([
          new Promise((resolve) => controller.once('roomba:queue-empty', resolve)),
          new Promise((resolve) => setTimeout(resolve, 10000)), // 10s safety timeout
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
    this.isRunning = false;
    this.emit('aiModeStatus', false);
    loopRunning = false;
    lastResponse = '';
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
  runCommands,
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; AIControlLoop.emit('goalCleared'); },
  setParams,
  getParams,
};
