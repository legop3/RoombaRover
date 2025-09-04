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
const CHUNK_MAX = 200;
const RAW_MAX = 500;
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
// Reflex executor cadence
const ACT_CADENCE_MS   = 250;

// Planner cadence (LLM)
const PLAN_INTERVAL_MS = 1200; // ~0.8 Hz

// Attach a camera keyframe every N plans
const KEYFRAME_INTERVAL = 3;

// LLM decode budgets (CPU friendly)
const NUM_PREDICT_PLAN_JSON = 80;
const NUM_PREDICT_PLAN_TXT  = 80;

// Clamp tiny forwards up so you see progress
const MIN_FORWARD_MM = 120;

// Degrees clamp for turns
const MIN_TURN_DEG = 8;
const MAX_TURN_DEG = 45;

// Forward clamp
const MIN_FWD_MM = 20;
const MAX_FWD_MM = 300;

// Stop sequences to curb “scripting language” drift (no '\n'—too risky)
const PLAN_STOP_SEQS = ['[[END]]', '[[', 'STOP'];

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
   Prompts (Navigator)
========================= */
function buildSystemPromptPlanJSON() {
  return (
    systemPromptBase + '\n\n' +
    'ROLE: Short-horizon egocentric navigator. Camera is forward-facing; left/right are in IMAGE SPACE.\n' +
    'RETURN STRICT JSON with keys: mode, turn_deg, forward_mm, ttl, say.\n' +
    'Constraints:\n' +
    '- mode ∈ {"CORRIDOR_ALIGN","WALL_FOLLOW_LEFT","WALL_FOLLOW_RIGHT","OPEN_SWEEP","DOORWAY_APPROACH"}\n' +
    '- turn_deg ∈ [-45..45] (positive = left; negative = right)\n' +
    '- forward_mm ∈ [20..300]\n' +
    '- ttl ∈ [3..10]\n' +
    '- say (short string, optional)\n' +
    'SAFETY: If any bump ON, prefer turn away or small backward before forward.\n' +
    'PREFERENCE: If center clear, prefer forward 140–220; else turn 10–20 then forward.\n' +
    'FORMAT (STRICT): a single JSON object, no code fences, no prose, no leading/trailing text.\n' +
    'Example: {"mode":"OPEN_SWEEP","turn_deg":-15,"forward_mm":180,"ttl":6,"say":"scanning right"}\n'
  );
}

function buildSystemPromptPlanTXT() {
  return (
    systemPromptBase + '\n\n' +
    'ROLE: Short-horizon egocentric navigator.\n' +
    'OUTPUT (STRICT): ONE line starting with [[PLAN]] and key=value pairs, then STOP. No prose.\n' +
    'Example:\n' +
    '[[PLAN]] mode=OPEN_SWEEP; turn_deg=-15; forward_mm=180; ttl=6; say="scanning right"\n' +
    'Keys:\n' +
    '- mode ∈ {CORRIDOR_ALIGN, WALL_FOLLOW_LEFT, WALL_FOLLOW_RIGHT, OPEN_SWEEP, DOORWAY_APPROACH}\n' +
    '- turn_deg ∈ [-45..+45] (positive = left, negative = right)\n' +
    '- forward_mm ∈ [20..300]\n' +
    '- ttl ∈ [3..10]\n' +
    '- say (optional)\n'
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
   Planner with robust decode:
   1) JSON (format:'json')
   2) [[PLAN]] txt fallback
   3) local synthesized plan
========================= */
let plansSinceKeyframe = 0;

async function requestPlan(forceKeyframe=false) {
  const includeImage = forceKeyframe || (plansSinceKeyframe >= (KEYFRAME_INTERVAL - 1));
  const started = Date.now();
  const cg = currentGoal || 'Explore safely; improve view when uncertain.';
  dlog('---- requestPlan ---- image:', includeImage, 'goal:', cg);

  // Try JSON first
  const jsonPlan = await tryPlanJSON(includeImage).catch(e=>{ dwarn('tryPlanJSON error:', e?.message||e); return null; });
  if (jsonPlan) {
    dlog('PLAN from JSON:', jsonPlan);
    plansSinceKeyframe = includeImage ? 0 : plansSinceKeyframe + 1;
    return normalizePlan(jsonPlan, 'json', started);
  }

  // Fallback to [[PLAN]] line
  const txtPlan = await tryPlanTXT(includeImage).catch(e=>{ dwarn('tryPlanTXT error:', e?.message||e); return null; });
  if (txtPlan) {
    dlog('PLAN from [[PLAN]]:', txtPlan);
    plansSinceKeyframe = includeImage ? 0 : plansSinceKeyframe + 1;
    return normalizePlan(txtPlan, 'txt', started);
  }

  // Last resort: synthesize locally (so we keep moving)
  const synth = synthesizeFallbackPlan();
  dlog('PLAN synthesized (fallback):', synth);
  plansSinceKeyframe = includeImage ? 0 : plansSinceKeyframe + 1;
  return normalizePlan(synth, 'synth', started);
}

function normalizePlan(plan, source, startedTs) {
  const p = { ...plan };

  // numeric clamps
  if (typeof p.turn_deg === 'number') p.turn_deg = clamp(p.turn_deg, -MAX_TURN_DEG, MAX_TURN_DEG) ?? 0;
  else p.turn_deg = 0;

  if (typeof p.forward_mm === 'number') p.forward_mm = clamp(p.forward_mm, MIN_FWD_MM, MAX_FWD_MM) ?? 0;
  else p.forward_mm = 0;

  if (p.forward_mm > 0 && p.forward_mm < MIN_FORWARD_MM) {
    dlog('bump up forward for visibility:', p.forward_mm, '->', MIN_FORWARD_MM);
    p.forward_mm = MIN_FORWARD_MM;
  }

  p.ttl = Math.max(3, Math.min(10, parseInt(p.ttl || 5, 10) || 5));
  p.mode = String(p.mode || 'OPEN_SWEEP').toUpperCase();
  p.ts = Date.now();

  // Speak / emit intent if present
  if (p.say) {
    AIControlLoop.emit('intentUpdate', { ts: p.ts, text: `[[INTENT]] ${p.say}` });
    safeSocketEmit('intentUpdate', { ts: p.ts, text: `[[INTENT]] ${p.say}` });
    speak(p.say);
    pushRecentIntent(p.say);
  }

  dlog(`Plan normalized (${source}) latency ms:`, Date.now() - startedTs, p);
  return p;
}

/* --- Attempt 1: JSON plan --- */
async function tryPlanJSON(includeImage) {
  const resp = await ollama.chat({
    model: config?.ollama?.modelName,
    messages: [
      { role: 'system', content: buildSystemPromptPlanJSON() },
      buildPlanUserMessage(includeImage),
    ],
    stream: true,
    keep_alive: -1,
    format: 'json', // ASK FOR JSON
    options: {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
      num_predict: NUM_PREDICT_PLAN_JSON,
      stop: PLAN_STOP_SEQS,
    }
  });

  let raw = '';
  let chunkCount = 0;
  for await (const part of resp) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    chunkCount++;
    raw += chunk;
    AIControlLoop.emit('streamChunk', chunk);
    const preview = chunk.replace(/\s+/g,' ').slice(0, CHUNK_MAX);
    dlog(`plan(JSON) chunk#${chunkCount}: "${preview}${chunk.length>CHUNK_MAX?'…':''}"`);
  }
  AIControlLoop.emit('responseComplete', raw);
  lastResponse = raw;

  try {
    const obj = JSON.parse(raw);
    return pickPlanFields(obj);
  } catch (e) {
    dwarn('JSON parse failed; raw=', raw.slice(0, RAW_MAX));
    return null;
  }
}

/* --- Attempt 2: [[PLAN]] line --- */
async function tryPlanTXT(includeImage) {
  const resp = await ollama.chat({
    model: config?.ollama?.modelName,
    messages: [
      { role: 'system', content: buildSystemPromptPlanTXT() },
      buildPlanUserMessage(includeImage),
    ],
    stream: true,
    keep_alive: -1,
    options: {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
      num_predict: NUM_PREDICT_PLAN_TXT,
      stop: PLAN_STOP_SEQS,
    }
  });

  let raw = '';
  let chunkCount = 0;
  for await (const part of resp) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    chunkCount++;
    raw += chunk;
    AIControlLoop.emit('streamChunk', chunk);
    const preview = chunk.replace(/\s+/g,' ').slice(0, CHUNK_MAX);
    dlog(`plan(TXT) chunk#${chunkCount}: "${preview}${chunk.length>CHUNK_MAX?'…':''}"`);
  }
  AIControlLoop.emit('responseComplete', raw);
  lastResponse = raw;

  const plan = parsePlanFromText(raw);
  if (!plan) {
    dwarn('No [[PLAN]] parsed; raw=', raw.slice(0, RAW_MAX));
    return null;
  }
  return plan;
}

/* --- Pick only the fields we care about from JSON --- */
function pickPlanFields(obj) {
  const p = {};
  if (obj && typeof obj === 'object') {
    if (obj.mode) p.mode = String(obj.mode);
    if (obj.turn_deg !== undefined) p.turn_deg = Number(obj.turn_deg);
    if (obj.forward_mm !== undefined) p.forward_mm = Number(obj.forward_mm);
    if (obj.ttl !== undefined) p.ttl = Number(obj.ttl);
    if (obj.say !== undefined && obj.say !== null) p.say = String(obj.say);
  }
  // Require at least some motion or a say; otherwise reject
  if (!p.say && !Number.isFinite(p.turn_deg) && !Number.isFinite(p.forward_mm)) return null;
  return p;
}

/* --- [[PLAN]] parser --- */
function parsePlanFromText(text='') {
  const idx = text.indexOf('[[PLAN]]');
  if (idx === -1) return null;
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1,-1);
    }
    kvs[key] = val;
  }
  const plan = {};
  if (kvs.mode) plan.mode = String(kvs.mode).toUpperCase();
  if (kvs.turn_deg !== undefined) plan.turn_deg = parseFloat(kvs.turn_deg);
  if (kvs.rotate_deg !== undefined) plan.turn_deg = parseFloat(kvs.rotate_deg);
  if (kvs.forward_mm !== undefined) plan.forward_mm = parseFloat(kvs.forward_mm);
  if (kvs.fwd !== undefined) plan.forward_mm = parseFloat(kvs.fwd);
  if (kvs.ttl !== undefined) plan.ttl = parseInt(kvs.ttl,10);
  if (kvs.say) plan.say = String(kvs.say);

  // fallback: bracketed commands inside the line
  if (!plan.turn_deg && !plan.forward_mm) {
    const cmds = parseCommandsFromBuffer(tail);
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
  if (!plan.turn_deg && !plan.forward_mm && !plan.say) return null;
  return plan;
}

/* --- if LLM fails, synthesize something reasonable --- */
function synthesizeFallbackPlan() {
  const bumpL = roombaStatus?.bumpSensors?.bumpLeft;
  const bumpR = roombaStatus?.bumpSensors?.bumpRight;
  const lb = roombaStatus?.lightBumps || {};
  // Simple heuristics:
  // - on bump: back & turn away
  // - if left brighter than right: steer right a bit, else steer left a bit
  // - always give a decent forward stride so it goes somewhere
  if (bumpL && !bumpR) {
    return { mode: 'OPEN_SWEEP', turn_deg: -20, forward_mm: 140, ttl: 5, say: 'avoiding left obstacle' };
  }
  if (bumpR && !bumpL) {
    return { mode: 'OPEN_SWEEP', turn_deg: +20, forward_mm: 140, ttl: 5, say: 'avoiding right obstacle' };
  }
  const leftSum  = (lb.LBL||0) + (lb.LBFL||0) + (lb.LBCL||0);
  const rightSum = (lb.LBR||0) + (lb.LBFR||0) + (lb.LBCR||0);
  const steer = (rightSum > leftSum) ? +12 : -12; // bias away from the brighter side
  return { mode: 'OPEN_SWEEP', turn_deg: steer, forward_mm: 180, ttl: 6, say: 'sweeping ahead' };
}

/* =========================
   Command parser (fallback)
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
function pushRecentAction(s){ if(!s) return; recentActions.push(s); while(recentActions.length > MAX_MEM_ACTIONS) recentActions.shift(); }
function pushRecentIntent(s){ if(!s) return; recentIntents.push(s); while(recentIntents.length > MAX_MEM_INTENTS) recentIntents.shift(); }

/* =========================
   Reflex executor (same as before, but runs plan fields)
========================= */
let execTimer = null;
function startExecutor() {
  if (execTimer) return;
  execTimer = setInterval(() => {
    if (!loopRunning) return;

    // Hazards clear current plan then we replan
    const bumpL = roombaStatus?.bumpSensors?.bumpLeft;
    const bumpR = roombaStatus?.bumpSensors?.bumpRight;
    if (bumpL || bumpR) {
      if (activePlan) dlog('BUMP detected, clearing plan and requesting immediate replan');
      activePlan = null;
      if (bumpL && !bumpR) controller.move(-140, -20);
      else if (bumpR && !bumpL) controller.move(-140, +20);
      else controller.move(-160, +20);
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
      pushRecentAction(`${lastCommand.action} ${lastCommand.value}`);
      activePlan.turn_deg = 0;
    } else if (Math.abs(fwd) >= MIN_FWD_MM) {
      dlog('EXEC forward:', fwd);
      controller.move(fwd, 0);
      lastCommand = { action: fwd >= 0 ? 'forward' : 'backward', value: String(Math.abs(Math.round(fwd))) };
      pushRecentAction(`${lastCommand.action} ${lastCommand.value}`);
      activePlan.forward_mm = 0;
    } else {
      // nothing left this cycle; shorten TTL to finish plan
      activePlan.ttl = 1;
    }

    activePlan.ttl -= 1;
    dlog('PLAN ttl->', activePlan.ttl);
  }, ACT_CADENCE_MS);
}
function stopExecutor() { if (execTimer) clearInterval(execTimer); execTimer = null; }

/* =========================
   Planner scheduler
========================= */
let planTimer = null;
let planSoon  = false;

function requestPlanSoon(forceKeyframe=false) { planSoon = planSoon || forceKeyframe; }

function startPlanner() {
  if (planTimer) return;
  planTimer = setInterval(async () => {
    if (!loopRunning) return;
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
function stopPlanner() { if (planTimer) clearInterval(planTimer); planTimer = null; }

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
========================= */
async function streamChatFromCameraImage(cameraImageBase64) {
  try {
    const includeImage = !!(cameraImageBase64 && cameraImageBase64.length);
    dlog('streamChatFromCameraImage includeImage:', includeImage, 'len:', cameraImageBase64 ? cameraImageBase64.length : 0);
    const plan = await requestPlan(includeImage);
    if (plan) { activePlan = plan; dlog('ONE-SHOT NEW PLAN:', plan); }
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
  runCommands: (cmds) => { // compatibility path: convert to micro-plan
    dlog('runCommands (compat):', cmds);
    if (!Array.isArray(cmds)) return;
    for (const c of cmds) {
      const p = { turn_deg: 0, forward_mm: 0, ttl: 3, ts: Date.now() };
      if (c.action === 'left')  p.turn_deg = clamp(parseFloat(c.value),  MIN_TURN_DEG, MAX_TURN_DEG) || 0;
      if (c.action === 'right') p.turn_deg = - (clamp(parseFloat(c.value), MIN_TURN_DEG, MAX_TURN_DEG) || 0);
      if (c.action === 'forward') p.forward_mm = clamp(parseFloat(c.value), MIN_FWD_MM, MAX_FWD_MM) || 0;
      if (c.action === 'backward') p.forward_mm = - (clamp(parseFloat(c.value), MIN_FWD_MM, MAX_FWD_MM) || 0);
      activePlan = p;
    }
  },
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; dlog('clearGoal'); AIControlLoop.emit('goalCleared'); requestPlanSoon(true); },
  setParams,
  getParams,
};
