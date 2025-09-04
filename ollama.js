/* eslint-disable no-console */
const { driveDirect, playRoombaSong, RoombaController } = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const roombaStatus = require('./roombaStatus');
const { Ollama } = require('ollama');

// ==== External Ollama client (all reasoning remote) ====
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });

// ==== Controller ====
const controller = new RoombaController(port);

// ==== Prompts (unchanged files on disk) ====
const chatPrompt = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');
function safeRead(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } }

// ==== State ====
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;
let loopRunning = false;

// Params (drop-in compatible)
const defaultParams = {
  temperature: config.ollama?.parameters?.temperature ?? 0.5,
  top_k: config.ollama?.parameters?.top_k ?? 40,
  top_p: config.ollama?.parameters?.top_p ?? 0.9,
  min_k: config.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

// ==== System prompt (FAST: commands first) ====
function buildSystemPrompt() {
  return (
    systemPromptBase +
    '\n\n' +
    'ROLE: You are a low-level egocentric navigation policy. Camera is forward-facing; left/right are in IMAGE SPACE.\n' +
    'OUTPUT ORDER (STRICT, FOR SPEED):\n' +
    '1) [[ACT]]\n' +
    '2) ONLY bracketed commands, max 4, then finish with [[END]]\n' +
    '3) (optional) [[STATE]] and [[CRITIC]] AFTER [[END]] if you have tokens left\n' +
    '\n' +
    'ACTION SET (only these verbs):\n' +
    '- [forward <mm>]   (20–300)\n' +
    '- [backward <mm>]  (20–300)\n' +
    '- [left <deg>]     (5–45)\n' +
    '- [right <deg>]    (5–45)\n' +
    '- [say <short>]\n' +
    '- [new_goal <text>]\n' +
    '\n' +
    'RULES:\n' +
    '- [[ACT]] MUST COME FIRST. Keep total output very short; prefer 2–3 actions.\n' +
    '- If you include [new_goal ...], you MUST ALSO include at least one movement command.\n' +
    '- If a bump sensor is ON, back up a small amount or rotate away before any forward.\n' +
    '- When unsure, prefer small rotation (10–20 deg) to scan. If center looks clear, use 100–200 mm forward.\n'
  );
}

// ==== User prompt (compact, egocentric) ====
function buildUserPrompt(cameraImageBase64) {
  const bumpLeft = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpRight = !!(roombaStatus?.bumpSensors?.bumpRight);
  const lb = roombaStatus?.lightBumps || {};
  const lightStr = [
    `LBL:${lb.LBL ?? 0}`, `LBFL:${lb.LBFL ?? 0}`, `LBCL:${lb.LBCL ?? 0}`,
    `LBCR:${lb.LBCR ?? 0}`, `LBFR:${lb.LBFR ?? 0}`, `LBR:${lb.LBR ?? 0}`,
  ].join(' ');
  const goal = currentGoal || 'Explore safely; improve view when uncertain.';
  const lastCmd = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';

  const content =
    `iter:${iterationCount}\n` +
    `last:${lastCmd}\n` +
    `goal:${goal}\n` +
    `bumpL:${bumpLeft} bumpR:${bumpRight}\n` +
    `light:${lightStr}\n\n` +
    'Return [[ACT]] then 2–3 commands, then [[END]].\n' +
    chatPrompt;

  const msg = { role: 'user', content };
  if (cameraImageBase64 && cameraImageBase64.length > 0) {
    const clean = cameraImageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    msg.images = [clean];
  }
  return msg;
}

// ==== Streaming chat with early [[ACT]] and live execution ====
async function streamChatFromCameraImage(cameraImageBase64) {
  const userMsg = buildUserPrompt(cameraImageBase64);
  const sysMsg = buildSystemPrompt();

  try {
    const response = await ollama.chat({
      model: config.ollama.modelName,
      messages: [
        { role: 'system', content: sysMsg },
        userMsg,
      ],
      stream: true,
      keep_alive: -1,
      options: {
        temperature: movingParams.temperature,
        top_k: movingParams.top_k,
        top_p: movingParams.top_p,
        min_k: movingParams.min_k,
        num_predict: 128,               // keep it short = faster CPU decode
        stop: ['[[END]]'],              // encourage quick stop
      },
    });

    let full = '';
    let actSeen = false;
    let actBuf = '';
    const executed = new Set(); // de-dupe within a single reply

    for await (const part of response) {
      const chunk = part?.message?.content || '';
      if (!chunk) continue;

      full += chunk;
      AIControlLoop.emit('streamChunk', chunk); // preserve UI typing

      if (!actSeen) {
        const idx = full.toUpperCase().indexOf('[[ACT]]');
        if (idx !== -1) {
          actSeen = true;
          actBuf = full.slice(idx + '[[ACT]]'.length);
        }
      } else {
        actBuf += chunk;
      }

      // As soon as we have any text after [[ACT]], try to parse commands and execute new ones
      if (actSeen && actBuf.length > 0) {
        const cmds = parseCommandsFromBuffer(actBuf);
        const fresh = cmds.filter(c => !executed.has(c.fullMatch));

        if (fresh.length > 0) {
          runCommands(fresh);
          fresh.forEach(c => {
            executed.add(c.fullMatch);
            AIControlLoop.emit('commandExecuted', c);
          });

          // Optional: strip executed commands from actBuf to avoid reparse storms
          actBuf = removeExecutedCommands(actBuf, fresh);
        }
      }
    }

    // End-of-stream cleanup
    // If model never printed [[ACT]], try once across the whole response
    if (!actSeen) {
      const leftover = parseCommandsFromBuffer(full);
      const fresh = leftover.filter(c => !executed.has(c.fullMatch));
      if (fresh.length > 0) {
        runCommands(fresh);
        fresh.forEach(c => AIControlLoop.emit('commandExecuted', c));
      }
    }

    AIControlLoop.emit('responseComplete', full);
    lastResponse = full;
    return full;
  } catch (err) {
    console.error('Error in streaming chat:', err);
    AIControlLoop.emit('streamError', err);
    throw err;
  }
}

// ==== Parsing (ONLY allowed verbs) ====
function parseCommandsFromBuffer(buffer = '') {
  const commands = [];
  const re = /\[(forward|backward|left|right|say|new_goal) ([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(buffer)) !== null) {
    const action = (m[1] || '').toLowerCase();
    const value = (m[2] || '').trim();
    commands.push({ action, value, fullMatch: m[0] });
  }
  return commands;
}

function removeExecutedCommands(buffer, executedCommands) {
  let s = buffer;
  for (const cmd of executedCommands) s = s.replace(cmd.fullMatch, '');
  return s;
}

// ==== Speech (flite) ====
const speechQueue = [];
let isSpeaking = false;
function speak(text) { speechQueue.push(text); processSpeechQueue(); }
function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  const fl = spawn('flite', ['-voice', 'rms', '-t', String(text)]);
  isSpeaking = true;
  const done = () => { isSpeaking = false; processSpeechQueue(); };
  fl.on('close', done); fl.on('exit', done); fl.on('error', done);
}

// ==== Execute commands immediately (no local inference) ====
function runCommands(commands) {
  for (const command of commands) {
    const action = String(command.action || '').toLowerCase();
    if (!loopRunning) { console.log('loop not running, skipping command'); continue; }
    lastCommand = command;

    switch (action) {
      case 'forward': {
        const mm = parseFloat(command.value);
        if (Number.isFinite(mm)) controller.move(mm, 0);
        else console.error('Invalid forward value:', command.value);
        break;
      }
      case 'backward': {
        const mm = parseFloat(command.value);
        if (Number.isFinite(mm)) controller.move(-mm, 0);
        else console.error('Invalid backward value:', command.value);
        break;
      }
      case 'left': {
        const deg = parseFloat(command.value);
        if (Number.isFinite(deg)) controller.move(0, deg);
        else console.error('Invalid left value:', command.value);
        break;
      }
      case 'right': {
        const deg = parseFloat(command.value);
        if (Number.isFinite(deg)) controller.move(0, -deg);
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
        console.error('Unknown command:', action);
    }
  }
}

// ==== AI Control Loop (public API preserved) ====
class AIControlLoopClass extends EventEmitter {
  constructor() { super(); this.isRunning = false; }

  async start() {
    if (this.isRunning) { console.log('Robot control loop is already running.'); return; }
    this.emit('aiModeStatus', true);
    this.isRunning = true;
    loopRunning = true;
    iterationCount = 0;

    while (this.isRunning) {
      try {
        iterationCount++;
        this.emit('controlLoopIteration', { iterationCount, status: 'started' });

        // Camera frame (best-effort)
        let cameraImage = null;
        try { cameraImage = getLatestFrontFrame(); } catch { cameraImage = null; }

        // Ask Ollama; commands will stream + execute as they appear
        try { await streamChatFromCameraImage(cameraImage); }
        catch (e) { console.error('Streaming error:', e); this.emit('streamError', e); }

        // Short wait between cycles (kept small for speed)
        await Promise.race([
          new Promise((resolve) => controller.once('roomba:queue-empty', resolve)),
          new Promise((resolve) => setTimeout(resolve, 300)), // trimmed for faster cadence
        ]);

        await new Promise((r) => setTimeout(r, 60)); // gentle pacing
        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
      } catch (err) {
        console.error(`Error in control loop iteration ${iterationCount}:`, err);
        this.emit('controlLoopError', err);
        await new Promise((r) => setTimeout(r, 200));
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

// ==== Goal & params (public API preserved) ====
async function setGoal(goal) { currentGoal = goal; AIControlLoop.emit('goalSet', goal); }
function setParams(params) {
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined) movingParams.top_k = params.top_k;
  if (params.top_p !== undefined) movingParams.top_p = params.top_p;
  if (params.min_k !== undefined) movingParams.min_k = params.min_k;
}
function getParams() { return { ...movingParams }; }

// ==== Export (unchanged shape) ====
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
