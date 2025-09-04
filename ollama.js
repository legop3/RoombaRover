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

/* =========================
   Debug
========================= */
const DEBUG = true;
const CHUNK_MAX = 160;
const dlog  = (...a)=>DEBUG&&console.log('[OLLAMA]', ...a);
const dwarn = (...a)=>console.warn('[OLLAMA]', ...a);
const derr  = (...a)=>console.error('[OLLAMA]', ...a);

/* =========================
   External Ollama client
========================= */
const ollama = new Ollama({
  host: `${config?.ollama?.serverURL}:${config?.ollama?.serverPort}`,
});

/* =========================
   Controller
========================= */
const controller = new RoombaController(port);

/* =========================
   Optional Socket.IO (guarded)
========================= */
let io = null;
try { io = global.io || null; } catch { io = null; }
function safeSocketEmit(event, payload) {
  try { if (io && typeof io.emit === 'function') io.emit(event, payload); } catch { /* noop */ }
}

/* =========================
   Safe prompt reads
========================= */
function safeRead(p){ try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } }
const chatPrompt       = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');

/* =========================
   State
========================= */
let iterationCount = 0;
let lastResponse   = '';
let currentGoal    = null;
let lastCommand    = null;
let loopRunning    = false;

/** The active short-horizon plan produced by the LLM */
let activePlan = null; // { mode, turn_deg, forward_mm, ttl, say, ts }

/** Rolling tiny memory to carry purpose across plans */
const recentActions = [];
const recentIntents = [];
const MAX_MEM_ACTIONS = 8;
const MAX_MEM_INTENTS = 8;

/* =========================
   Tunables (fast)
========================= */
// Reflex executor cadence: feels real-time
const ACT_CADENCE_MS   = 250;

// Navigator (planner) cadence: low frequency
const PLAN_INTERVAL_MS = 1200; // ~0.8 Hz; adjust 800–2000ms

// Attach a camera keyframe every N plans
const KEYFRAME_INTERVAL = 3;

// Keep LLM decode short for CPU
const NUM_PREDICT_PLAN  = 64;

// Clamp tiny forwards up so you see progress
const MIN_FORWARD_MM    = 120;

// Degrees clamp for turns
const MIN_TURN_DEG = 8;
const MAX_TURN_DEG = 45;

// Forward clamp
const MIN_FWD_MM = 20;
const MAX_FWD_MM = 300;

// Stop sequences to curb “scripting language” drift
const PLAN_STOP_SEQS = ['\n', '[[END]]', '[[', 'STOP'];

/* =========================
   Parameters (drop-in)
========================= */
const defaultParams = {
  temperature: config?.ollama?.parameters?.temperature ?? 0.2,
  top_k:       config?.ollama?.parameters?.top_k ?? 40,
  top_p:       config?.ollama?.parameters?.top_p ?? 0.9,
  min_k:       config?.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

/* =========================
   Prompts (Navigator => one [[PLAN]] line)
========================= */
function buildSystemPromptPlan() {
  return (
    systemPromptBase + '\n\n' +
    'ROLE: You are a short-horizon egocentric navigator. Camera is forward-facing; left/right are in IMAGE SPACE.\n' +
    'TASK: Produce ONE compact plan line that a reflex controller can execute for ~1–3 seconds.\n' +
    'OUTPUT (STRICT): A single line starting with [[PLAN]] and key=value pairs, then newline, and STOP.\n' +
    'Example:\n' +
    '[[PLAN]] mode=CORRIDOR_ALIGN; turn_deg=+15; forward_mm=160; ttl=6; say="scanning right for corridor"\n' +
    'Keys:\n' +
    '- mode ∈ {CORRIDOR_ALIGN, WALL_FOLLOW_LEFT, WALL_FOLLOW_RIGHT, OPEN_SWEEP, DOORWAY_APPROACH}\n' +
    '- turn_deg ∈ [-45..+45] (positive = left, negative = right)\n' +
    '- forward_mm ∈ [20..300]\n' +
    '- ttl ∈ [3..10]  (how many reflex ticks to keep executing this plan)\n' +
    '- say (optional short intent)\n' +
    'Safety: If any bump is ON, prefer small turn away or backward, then short forward.\n' +
    'If center looks clear, prefer forward 140–220; if uncertain, turn 10–20 then small forward.\n' +
    'Do NOT output code, lists, or extra prose.\n'
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

function buildPlanUserMessage(includeImage) {
  const bumpLeft  = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpRight = !!(roombaStatus?.bumpSensors?.bumpRight);
  const goal      = currentGoal || 'Explore safely; improve view when uncertain.';
  const lastCmd   = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';
  const lightStr  = packLightBumps();
  const memLine   = buildMemoryLine();

  const body =
    `PLAN_REQUEST ${Date.now()}\n` +
    `goal:${goal}\n` +
    `last:${lastCmd}\n` +
    `bumpL:${bumpLeft} bumpR:${bumpRight}\n` +
    `light:${lightStr}\n` +
    `${memLine}\n` +
    'Output ONE [[PLAN]] line with key=value pairs, then newline. No other text.\n' +
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
      dlog('No camera frame available for plan', payload);
      AIControlLoop.emit('cameraFrameCaptured', payload);
      safeSocketEmit('cameraFrameCaptured', payload);
    }
  }
  return msg;
}

function getLatestFrontFrameSafe() {
  try { return getLatestFrontFrame(); }
  catch (e){ dwarn('getLatestFrontFrame error:', e?.message || e); return null; }
}

/* =========================
   Plan request (streaming one line; early parse)
========================= */
let plansSinceKeyframe = 0;

async function requestPlan(forceKeyframe=false) {
  const includeImage = forceKeyframe || (plansSinceKeyframe >= (KEYFRAME_INTERVAL - 1));
  const started = Date.now();
  const cg = currentGoal || 'Explore safely; improve view when uncertain.';
  dlog('---- requestPlan ---- image:', includeImage, 'goal:', cg);

  const response = await ollama.chat({
    model: config?.ollama?.modelName,
    messages: [
      { role: 'system', content: buildSystemPromptPlan() },
      buildPlanUserMessage(includeImage),
    ],
    stream: true,
    keep_alive: -1,
    options: {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
      num_predict: NUM_PREDICT_PLAN,
      stop: PLAN_STOP_SEQS,
    }
  });

  let line = '';
  let chunkCount = 0;
  let parsed = null;

  for await (const part of response) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    chunkCount++;
    AIControlLoop.emit('streamChunk', chunk);
    line += chunk;
    const preview = chunk.replace(/\s+/g,' ').slice(0, CHUNK_MAX);
    dlog(`plan chunk#${chunkCount}: "${preview}${chunk.length>CHUNK_MAX?'…':''}"`);

    // Try to parse as soon as [[PLAN]] appears
    if (!parsed && line.includes('[[PLAN]]')) {
      const parsedTry = parsePlanFromText(line);
      if (parsedTry) {
        parsed = parsedTry;
        dlog('FIRST plan parsed at ms:', Date.now()-started, parsed);
        // We don't break the stream; we just note the plan. (Stops will end soon.)
      }
    }
  }

  AIControlLoop.emit('responseComplete', line);
  lastResponse = line;

  if (!parsed) {
    parsed = parsePlanFromText(line);
    if (!parsed) {
      dwarn('No valid [[PLAN]] parsed. Line was:', JSON.stringify(line));
      return null;
    }
    dlog('Plan parsed after stream end at ms:', Date.now()-started, parsed);
  }

  // Normalize and clamp
  parsed.turn_deg   = clamp(parsed.turn_deg ?? 0, -MAX_TURN_DEG, MAX_TURN_DEG);
  parsed.forward_mm = clamp(parsed.forward_mm ?? 0, MIN_FWD_MM, MAX_FWD_MM);
  if (parsed.forward_mm > 0 && parsed.forward_mm < MIN_FORWARD_MM) {
    dlog('bump up forward for visibility:', parsed.forward_mm, '->', MIN_FORWARD_MM);
    parsed.forward_mm = MIN_FORWARD_MM;
  }
  parsed.ttl = Math.max(3, Math.min(10, parsed.ttl || 5));
  parsed.ts  = Date.now();

  // Speak / emit intent if present
  if (parsed.say) {
    AIControlLoop.emit('intentUpdate', { ts: parsed.ts, text: `[[INTENT]] ${parsed.say}` });
    safeSocketEmit('intentUpdate', { ts: parsed.ts, text: `[[INTENT]] ${parsed.say}` });
    speak(parsed.say);
    pushRecentIntent(parsed.say);
  }

  // Mark keyframe cadence
  plansSinceKeyframe = includeImage ? 0 : (plansSinceKeyframe + 1);
  return parsed;
}

/* =========================
   Plan parsing
   Accepts formats like:
   [[PLAN]] mode=WALL_FOLLOW_LEFT; turn_deg=+15; forward_mm=160; ttl=6; say="scan right"
========================= */
function parsePlanFromText(text='') {
  const idx = text.indexOf('[[PLAN]]');
  if (idx === -1) return null;
  // Take till newline or end
  const tail = text.slice(idx).split(/\r?\n/)[0];
  const kvs = {};
  const pairs = tail.replace('[[PLAN]]','').split(';');
  for (let raw of pairs) {
    raw = raw.trim();
    if (!raw) continue;
    const m = /^([a-zA-Z_]+)\s*=\s*(.+)$/.exec(raw);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let val  = m[2].trim();
    // strip quotes for say="..."
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1,-1);
    }
    kvs[key] = val;
  }

  // Build plan
  const plan = {};
  if (kvs.mode) plan.mode = String(kvs.mode).toUpperCase();
  if (kvs.turn_deg !== undefined) plan.turn_deg = parseFloat(kvs.turn_deg);
  if (kvs.rotate_deg !== undefined) plan.turn_deg = parseFloat(kvs.rotate_deg);
  if (kvs.forward_mm !== undefined) plan.forward_mm = parseFloat(kvs.forward_mm);
  if (kvs.fwd !== undefined) plan.forward_mm = parseFloat(kvs.fwd);
  if (kvs.ttl !== undefined) plan.ttl = parseInt(kvs.ttl,10);
  if (kvs.say) plan.say = String(kvs.say);

  // Fallback: if LLM gave bracketed commands instead, approximate a plan
  if (!plan.turn_deg && !plan.forward_mm) {
    const cmds = parseCommandsFromBuffer(tail);
    if (cmds.length) {
      for (const c of cmds) {
        if (c.action === 'left')  plan.turn_deg = Math.max(MIN_TURN_DEG, parseFloat(c.value)||0);
        if (c.action === 'right') plan.turn_deg = -Math.max(MIN_TURN_DEG, parseFloat(c.value)||0);
        if (c.action === 'forward') plan.forward_mm = Math.max(MIN_FWD_MM, parseFloat(c.value)||0);
        if (c.action === 'backward') plan.forward_mm = -Math.max(MIN_FWD_MM, parseFloat(c.value)||0);
        if (c.action === 'say' && !plan.say) plan.say = c.value;
      }
      plan.ttl = plan.ttl || 5;
      plan.mode = plan.mode || 'OPEN_SWEEP';
    }
  }

  // If still nothing meaningful, bail
  if (!plan.turn_deg && !plan.forward_mm && !plan.say) return null;
  return plan;
}

/* =========================
   Command parser (for fallback / compatibility)
========================= */
function parseCommandsFromBuffer(text='') {
  const out = [];
  const br = /\[([^\]]+)\]/g;
  let m;
  while ((m = br.exec(text)) !== null) {
    const inner = (m[1] || '').trim();
    const norm  = normalizeCommand(inner);
    if (norm) out.push({ ...norm, fullMatch: m[0] });
  }
  return out;
}
function normalizeCommand(inner) {
  const s = inner.trim();
  const parts = s.split(/\s+/);
  const verbRaw = (parts[0] || '').toLowerCase();
  const rest = s.slice(verbRaw.length).trim();
  const verb = verbRaw;
  if (!['forward','backward','left','right','say','new_goal'].includes(verb)) return null;

  if (verb === 'say' || verb === 'new_goal') {
    if (!rest) return null;
    return { action: verb, value: rest };
  }

  let num = null;
  let m = /[-+]?\d+(\.\d+)?(?=\s*\))/.exec(rest);                 // deg(10) / mm(120)
  if (m) num = parseFloat(m[0]);
  if (num === null) { m = /([-+]?\d+(\.\d+)?)(?=\s*(mm|deg|degrees)\b)/i.exec(rest); if (m) num = parseFloat(m[1]); }
  if (num === null) { m = /(deg|degree|degrees|mm)\s*([-+]?\d+(\.\d+)?)/i.exec(rest); if (m) num = parseFloat(m[2]); }
  if (num === null) { m = /[-+]?\d+(\.\d+)?/.exec(rest); if (m) num = parseFloat(m[0]); }
  if (num === null || !Number.isFinite(num)) return null;

  if (verb === 'forward' || verb === 'backward') {
    num = clamp(num, MIN_FWD_MM, MAX_FWD_MM);
    if (verb === 'forward' && num < MIN_FORWARD_MM) num = MIN_FORWARD_MM;
  } else {
    num = clamp(num, MIN_TURN_DEG, MAX_TURN_DEG);
  }
  return { action: verb, value: String(Math.round(num)) };
}
function clamp(n, lo, hi){ if(!Number.isFinite(n)) return null; return Math.max(lo, Math.min(hi, n)); }

/* =========================
   Reflex executor
========================= */
let execTimer = null;

function startExecutor() {
  if (execTimer) return;
  execTimer = setInterval(() => {
    if (!loopRunning) return;

    // Hazard? nuke plan and back off with an immediate replan
    const bumpL = roombaStatus?.bumpSensors?.bumpLeft;
    const bumpR = roombaStatus?.bumpSensors?.bumpRight;
    if (bumpL || bumpR) {
      if (activePlan) dlog('BUMP detected, clearing plan and requesting immediate replan');
      activePlan = null;
      // quick reflex: small back + turn away
      if (bumpL && !bumpR) controller.move(-120, -15);
      else if (bumpR && !bumpL) controller.move(-120, +15);
      else controller.move(-140, +20);
      requestPlanSoon(true);
      return;
    }

    if (!activePlan || activePlan.ttl <= 0) return;

    // Execute one micro-step from plan
    const turn = activePlan.turn_deg || 0;
    const fwd  = activePlan.forward_mm || 0;

    if (Math.abs(turn) >= MIN_TURN_DEG) {
      dlog('EXEC turn:', turn);
      controller.move(0, turn);
      lastCommand = { action: turn > 0 ? 'left' : 'right', value: String(Math.abs(Math.round(turn))) };
      recentActions.push(`${lastCommand.action} ${lastCommand.value}`);
      while (recentActions.length > MAX_MEM_ACTIONS) recentActions.shift();
      activePlan.turn_deg = 0;
    } else if (Math.abs(fwd) >= MIN_FWD_MM) {
      dlog('EXEC forward:', fwd);
      controller.move(fwd, 0);
      lastCommand = { action: fwd >= 0 ? 'forward' : 'backward', value: String(Math.abs(Math.round(fwd))) };
      recentActions.push(`${lastCommand.action} ${lastCommand.value}`);
      while (recentActions.length > MAX_MEM_ACTIONS) recentActions.shift();
      activePlan.forward_mm = 0;
    } else {
      // Nothing left to do in this plan
      activePlan.ttl = 1; // finish quickly
    }

    // Decrement TTL
    activePlan.ttl -= 1;
    dlog('PLAN ttl->', activePlan.ttl);
  }, ACT_CADENCE_MS);
}
function stopExecutor() {
  if (execTimer) clearInterval(execTimer);
  execTimer = null;
}

/* =========================
   Planner scheduler
========================= */
let planTimer = null;
let planSoon  = false;

function requestPlanSoon(forceKeyframe=false) {
  planSoon = planSoon || forceKeyframe;
}

function startPlanner() {
  if (planTimer) return;
  planTimer = setInterval(async () => {
    if (!loopRunning) return;

    // If no plan or TTL low, or queued request, ask the navigator
    const need = planSoon || !activePlan || activePlan.ttl <= 0;
    if (!need) return;
    planSoon = false;

    try {
      const plan = await requestPlan(false);
      if (plan) {
        activePlan = plan;
        dlog('NEW PLAN:', plan);
      }
    } catch (e) {
      derr('requestPlan error:', e);
      AIControlLoop.emit('streamError', e);
    }
  }, PLAN_INTERVAL_MS);
}
function stopPlanner() {
  if (planTimer) clearInterval(planTimer);
  planTimer = null;
}

/* =========================
   Speech (flite)
========================= */
const speechQueue = [];
let isSpeaking = false;
function speak(text){ speechQueue.push(String(text)); processSpeechQueue(); }
function processSpeechQueue(){
  if (isSpeaking || speechQueue.length === 0) return;
  const text = speechQueue.shift();
  dlog('SAY:', text);
  const fl = spawn('flite', ['-voice', 'rms', '-t', text]);
  isSpeaking = true;
  const done = () => { isSpeaking = false; processSpeechQueue(); };
  fl.on('close', done); fl.on('exit', done); fl.on('error', (e)=>{ derr('flite error:', e?.message || e); done(); });
}

/* =========================
   Public one-shot (compat)
   -> now returns a fresh plan (and executes via reflex)
========================= */
async function streamChatFromCameraImage(cameraImageBase64) {
  try {
    const includeImage = !!(cameraImageBase64 && cameraImageBase64.length);
    dlog('streamChatFromCameraImage includeImage:', includeImage, 'len:', cameraImageBase64 ? cameraImageBase64.length : 0);
    const plan = await requestPlan(includeImage);
    if (plan) {
      activePlan = plan;
      dlog('ONE-SHOT NEW PLAN:', plan);
    }
    return lastResponse;
  } catch (e) {
    derr('streamChatFromCameraImage error:', e);
    AIControlLoop.emit('streamError', e);
    throw e;
  }
}

/* =========================
   AI Control Loop (drop-in)
========================= */
class AIControlLoopClass extends EventEmitter {
  constructor(){ super(); this.isRunning = false; }

  async start() {
    if (this.isRunning) { dlog('AI loop already running'); return; }
    this.isRunning = true;
    loopRunning = true;
    iterationCount = 0;
    plansSinceKeyframe = 0;
    activePlan = null;
    this.emit('aiModeStatus', true);
    dlog('AI loop START');

    // Kick everything
    startExecutor();
    startPlanner();
    requestPlanSoon(true); // force first keyframe
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    loopRunning = false;
    stopExecutor();
    stopPlanner();
    activePlan = null;
    this.emit('aiModeStatus', false);
    lastResponse = '';
    dlog('AI loop STOP');
  }
}

const AIControlLoop = new AIControlLoopClass();

/* =========================
   Goal & params (drop-in)
========================= */
async function setGoal(goal){ currentGoal = goal; dlog('setGoal:', goal); AIControlLoop.emit('goalSet', goal); requestPlanSoon(true); }
function setParams(params){
  dlog('setParams:', params);
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined)       movingParams.top_k = params.top_k;
  if (params.top_p !== undefined)       movingParams.top_p = params.top_p;
  if (params.min_k !== undefined)       movingParams.min_k = params.min_k;
}
function getParams(){ return { ...movingParams }; }

/* =========================
   Exports (unchanged shape)
========================= */
module.exports = {
  streamChatFromCameraImage,
  AIControlLoop,
  speak,
  runCommands: (cmds) => { // still here for compatibility; maps to reflex actions
    dlog('runCommands (compat):', cmds);
    if (!Array.isArray(cmds)) return;
    for (const c of cmds) {
      // interpret as an immediate micro-plan
      const p = { turn_deg: 0, forward_mm: 0, ttl: 3, ts: Date.now() };
      if (c.action === 'left')  p.turn_deg = clamp(parseFloat(c.value),  MIN_TURN_DEG, MAX_TURN_DEG);
      if (c.action === 'right') p.turn_deg = -clamp(parseFloat(c.value), MIN_TURN_DEG, MAX_TURN_DEG);
      if (c.action === 'forward') p.forward_mm = clamp(parseFloat(c.value), MIN_FWD_MM, MAX_FWD_MM);
      if (c.action === 'backward') p.forward_mm = -clamp(parseFloat(c.value), MIN_FWD_MM, MAX_FWD_MM);
      activePlan = p;
    }
  },
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; dlog('clearGoal'); AIControlLoop.emit('goalCleared'); requestPlanSoon(true); },
  setParams,
  getParams,
};
