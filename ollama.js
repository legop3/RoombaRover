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
   Debug / helpers
========================= */
const DEBUG = true;
const dlog  = (...a)=>DEBUG&&console.log('[OLLAMA]', ...a);
const dwarn = (...a)=>console.warn('[OLLAMA]', ...a);
const derr  = (...a)=>console.error('[OLLAMA]', ...a);

function clamp(n, lo, hi){
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(lo, Math.min(hi, x));
}
function safeRead(p){ try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } }

/* =========================
   External Ollama client
========================= */
const ollama = new Ollama({ host: `${config?.ollama?.serverURL}:${config?.ollama?.serverPort}` });

/* =========================
   Controller & optional Socket.IO
========================= */
const controller = new RoombaController(port);

let io = null;
try { io = global.io || null; } catch { io = null; }
function safeSocketEmit(event, payload) {
  try { if (io && typeof io.emit === 'function') io.emit(event, payload); } catch {}
}

/* =========================
   Prompts & params
========================= */
const chatPrompt       = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');

const defaultParams = {
  temperature: config?.ollama?.parameters?.temperature ?? 0.2,
  top_k:       config?.ollama?.parameters?.top_k ?? 40,
  top_p:       config?.ollama?.parameters?.top_p ?? 0.9,
  min_k:       config?.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

/* =========================
   State
========================= */
let loopRunning   = false;
let currentGoal   = null;
let lastCommand   = null;
let lastResponse  = '';
let lastForwardTs = 0;

/** Active macro plan emitted by the LLM */
let activePlan = null; // { intent, steps:[], ttl, ts, source, idx }

/** Memory for cheap continuity */
const recentActions = [];
const recentIntents = [];
const MAX_MEM = 8;

/* =========================
   Cadence / tunables (fast)
========================= */
const EXEC_INTERVAL_MS   = 250;   // ~4Hz reflex
const PLAN_INTERVAL_MS   = 1200;  // ~0.8Hz planner
const KEYFRAME_EVERY_N   = 3;     // send camera image every N plans
const NUM_PREDICT_PLAN   = 96;    // tiny decode for CPU-only server

// clamps / minimums
const TURN_MIN_DEG = 8;
const TURN_MAX_DEG = 45;
const FWD_MIN_MM   = 40;
const FWD_MAX_MM   = 300;
const FWD_VISIBLE_MM = 140;       // bump small forwards to be noticeable
const ANTI_DITHER_MS = 2200;      // enforce a forward if spinning too long

// Stops to kill rambly tails (we parse early anyway)
const PLAN_STOP_SEQS = ['[[END]]','[[','STOP'];

/* =========================
   Prompt builder
========================= */
function packLightBumps() {
  const lb = roombaStatus?.lightBumps || {};
  return `LBL:${lb.LBL ?? 0} LBFL:${lb.LBFL ?? 0} LBCL:${lb.LBCL ?? 0} LBCR:${lb.LBCR ?? 0} LBFR:${lb.LBFR ?? 0} LBR:${lb.LBR ?? 0}`;
}
function buildMemoryLine() {
  const acts = recentActions.slice(-MAX_MEM).join(',');
  const ints = recentIntents.slice(-MAX_MEM).join(',');
  return `mem:acts=${acts||'none'};intents=${ints||'none'}`;
}
function buildSystemPromptPlan() {
  return (
    systemPromptBase + '\n\n' +
    'ROLE: Short-horizon egocentric navigator. Camera is forward-facing; LEFT/RIGHT are in IMAGE SPACE.\n' +
    'TASK: Return a compact JSON macro plan for ~1–3s that a reflex loop can execute.\n' +
    'FORMAT (STRICT JSON): {"intent":string,"ttl":int,"steps":[...]} ONLY. No prose, no code fences.\n' +
    'Allowed steps (array of 1..4):\n' +
    '  {"a":"turn","deg":int}      // +deg=left, -deg=right, clamp to [-45..45]\n' +
    '  {"a":"forward","mm":int}    // 40..300\n' +
    '  {"a":"backward","mm":int}   // 40..300\n' +
    '  {"a":"speak","text":string}\n' +
    '  {"a":"set_goal","text":string}\n' +
    'Constraints & preferences:\n' +
    '- If any bumper ON: first step should clear (small back + turn away).\n' +
    '- If center looks clear: include a forward stride ~140–220mm.\n' +
    '- If uncertain: small turn (10–20°) then forward.\n' +
    '- Keep steps decisive (no 5mm/1° dithers). 1–3 steps are ideal.\n'
  );
}
function buildUserPlanMessage(includeImage, overrideImageBase64) {
  const bumpL = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpR = !!(roombaStatus?.bumpSensors?.bumpRight);
  const goal  = currentGoal || 'Explore safely; improve view when uncertain.';
  const light = packLightBumps();
  const last  = lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none';
  const mem   = buildMemoryLine();

  const body =
    `PLAN_REQUEST ${Date.now()}\n` +
    `goal:${goal}\n` +
    `last:${last}\n` +
    `bumpL:${bumpL} bumpR:${bumpR}\n` +
    `light:${light}\n` +
    `${mem}\n` +
    chatPrompt;

  const msg = { role: 'user', content: body };

  if (overrideImageBase64) {
    const clean = overrideImageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    msg.images = [clean];
    const payload = { ts: Date.now(), bytes: Buffer.byteLength(clean, 'base64'), included: true };
    AIControlLoop.emit('cameraFrameCaptured', payload);
    safeSocketEmit('cameraFrameCaptured', payload);
  } else if (includeImage) {
    const frame = getLatestFrontFrameSafe();
    const payload = { ts: Date.now(), bytes: 0, included: false };
    if (frame && frame.length) {
      const clean = frame.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      msg.images = [clean];
      payload.bytes = Buffer.byteLength(clean, 'base64');
      payload.included = true;
    }
    AIControlLoop.emit('cameraFrameCaptured', payload);
    safeSocketEmit('cameraFrameCaptured', payload);
  }

  return msg;
}
function getLatestFrontFrameSafe(){ try { return getLatestFrontFrame(); } catch { return null; } }

/* =========================
   Streaming plan request with early JSON parse
========================= */
let plansSinceKeyframe = 0;

async function requestPlan({ forceImage=false, overrideImageBase64=null } = {}) {
  const includeImage = forceImage || (plansSinceKeyframe >= (KEYFRAME_EVERY_N - 1));
  dlog('---- requestPlan ---- includeImage=', includeImage, 'goal=', currentGoal || '(none)');

  const resp = await ollama.chat({
    model: config?.ollama?.modelName,
    messages: [
      { role: 'system', content: buildSystemPromptPlan() },
      buildUserPlanMessage(includeImage, overrideImageBase64),
    ],
    stream: true,
    keep_alive: -1,
    format: 'json',
    options: {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
      num_predict: NUM_PREDICT_PLAN,
      stop: PLAN_STOP_SEQS,
    }
  });

  let raw = '';
  let parsed = null;
  for await (const part of resp) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    raw += chunk;
    AIControlLoop.emit('streamChunk', chunk);

    // Try early extraction of first complete JSON object
    if (!parsed) {
      const jsonSlice = extractFirstJSONObject(raw);
      if (jsonSlice) {
        try {
          parsed = JSON.parse(jsonSlice);
          dlog('EARLY plan parsed:', parsed);
        } catch { /* keep streaming until valid */ }
      }
    }
  }
  AIControlLoop.emit('responseComplete', raw);
  lastResponse = raw;

  if (!parsed) {
    const jsonSlice = extractFirstJSONObject(raw);
    if (jsonSlice) {
      try { parsed = JSON.parse(jsonSlice); }
      catch (e) { dwarn('JSON parse failed (end):', e?.message || e, 'raw head:', raw.slice(0,300)); }
    } else {
      dwarn('No JSON object found in stream. raw head:', raw.slice(0,300));
    }
  }

  plansSinceKeyframe = includeImage ? 0 : (plansSinceKeyframe + 1);

  if (!parsed) {
    // fallback curiosity macro
    const fb = makeFallbackPlan();
    dlog('PLAN fallback:', fb);
    return normalizePlan(fb, 'fallback');
  }
  return normalizePlan(parsed, 'json');
}

/* Extract the first complete top-level JSON object from a streaming string */
function extractFirstJSONObject(s='') {
  let depth = 0, inStr = false, esc = false, start = -1, quote = null;
  for (let i=0; i<s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) { inStr = false; quote = null; continue; }
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') { if (depth===0) start = i; depth++; continue; }
    if (c === '}') { depth--; if (depth===0 && start !== -1) return s.slice(start, i+1); continue; }
  }
  return null;
}

/* Normalize & clamp LLM plan to our internal macro */
function normalizePlan(plan, source) {
  const out = {
    intent: plan.intent ? String(plan.intent) : null,
    steps: [],
    ttl: Math.max(3, Math.min(10, parseInt(plan.ttl || 6, 10) || 6)),
    ts: Date.now(),
    source,
    idx: 0
  };

  if (Array.isArray(plan.steps)) {
    for (const st of plan.steps) {
      if (!st || typeof st !== 'object') continue;
      const a = (st.a || st.action || '').toString().toLowerCase();
      if (a === 'turn') {
        let deg = clamp(st.deg ?? st.degrees, -TURN_MAX_DEG, TURN_MAX_DEG);
        if (deg === null) continue;
        if (Math.abs(deg) < TURN_MIN_DEG) deg = deg >= 0 ? TURN_MIN_DEG : -TURN_MIN_DEG;
        out.steps.push({ a:'turn', deg: Math.round(deg) });
      } else if (a === 'forward') {
        let mm = clamp(st.mm, FWD_MIN_MM, FWD_MAX_MM);
        if (mm === null) continue;
        if (mm < FWD_VISIBLE_MM) mm = FWD_VISIBLE_MM;
        out.steps.push({ a:'forward', mm: Math.round(mm) });
      } else if (a === 'backward') {
        let mm = clamp(st.mm, FWD_MIN_MM, FWD_MAX_MM);
        if (mm === null) continue;
        out.steps.push({ a:'backward', mm: Math.round(mm) });
      } else if (a === 'speak') {
        const text = (st.text || '').toString().trim();
        if (text) out.steps.push({ a:'speak', text });
      } else if (a === 'set_goal') {
        const text = (st.text || '').toString().trim();
        if (text) out.steps.push({ a:'set_goal', text });
      }
      if (out.steps.length >= 4) break; // keep tight
    }
  }

  if (!out.steps.length) {
    // ensure we do something
    out.steps.push({ a:'turn', deg: 15 }, { a:'forward', mm: 180 });
  }

  if (out.intent) {
    AIControlLoop.emit('intentUpdate', { ts: out.ts, text: `[[INTENT]] ${out.intent}` });
    safeSocketEmit('intentUpdate', { ts: out.ts, text: `[[INTENT]] ${out.intent}` });
    speak(out.intent);
    recentIntents.push(out.intent); while (recentIntents.length > MAX_MEM) recentIntents.shift();
  }

  dlog('PLAN normalized:', out);
  return out;
}

/* Cheap curiosity fallback (no LLM) */
function makeFallbackPlan() {
  const bumpL = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpR = !!(roombaStatus?.bumpSensors?.bumpRight);
  const lb = roombaStatus?.lightBumps || {};
  const left  = (lb.LBL||0)+(lb.LBFL||0)+(lb.LBCL||0);
  const right = (lb.LBR||0)+(lb.LBFR||0)+(lb.LBCR||0);

  if (bumpL && !bumpR) return { intent:'avoiding left obstacle', steps:[{a:'backward',mm:160},{a:'turn',deg:-20},{a:'forward',mm:180}], ttl:6 };
  if (bumpR && !bumpL) return { intent:'avoiding right obstacle', steps:[{a:'backward',mm:160},{a:'turn',deg:+20},{a:'forward',mm:180}], ttl:6 };

  const steerLeft = right > left + 5;
  return {
    intent: 'sweeping ahead',
    steps: [{ a:'turn', deg: steerLeft ? +12 : -12 }, { a:'forward', mm: 200 }],
    ttl: 6
  };
}

/* =========================
   Reflex executor (one step per tick)
========================= */
let execTimer = null;
let stepCooldown = false;

function startExecutor() {
  if (execTimer) return;
  execTimer = setInterval(() => {
    if (!loopRunning || !activePlan) return;

    // stop if TTL spent
    if (activePlan.ttl <= 0 || activePlan.idx >= activePlan.steps.length) return;

    // bumper reflex: override the current plan with immediate avoidance
    const bumpL = !!(roombaStatus?.bumpSensors?.bumpLeft);
    const bumpR = !!(roombaStatus?.bumpSensors?.bumpRight);
    if (bumpL || bumpR) {
      dlog('BUMP reflex', { bumpL, bumpR });
      if (bumpL && !bumpR) controller.move(-140, -20);
      else if (bumpR && !bumpL) controller.move(-140, +20);
      else controller.move(-160, +20);
      lastCommand = { action: 'backward', value: '160' };
      recentActions.push('backward 160'); while (recentActions.length > MAX_MEM) recentActions.shift();
      // burn a tick and ask for new plan soon
      activePlan.ttl = Math.max(0, activePlan.ttl - 1);
      requestPlanSoon();
      return;
    }

    if (stepCooldown) return;

    const step = activePlan.steps[activePlan.idx];
    if (!step) return;

    executeStep(step);
    activePlan.idx += 1;
    activePlan.ttl = Math.max(0, activePlan.ttl - 1);

    // if we just turned for a while, force a forward now and then
    if (Date.now() - lastForwardTs > ANTI_DITHER_MS) {
      dlog('ANTI-DITHER: forcing forward stride');
      controller.move(FWD_VISIBLE_MM, 0);
      lastCommand = { action: 'forward', value: String(FWD_VISIBLE_MM) };
      recentActions.push(`forward ${FWD_VISIBLE_MM}`); while (recentActions.length > MAX_MEM) recentActions.shift();
      lastForwardTs = Date.now();
    }
  }, EXEC_INTERVAL_MS);
}

function executeStep(st) {
  stepCooldown = true;
  setTimeout(()=>{ stepCooldown = false; }, 180); // small spacing

  switch (st.a) {
    case 'turn': {
      const deg = clamp(st.deg, -TURN_MAX_DEG, TURN_MAX_DEG) ?? 0;
      if (Math.abs(deg) < TURN_MIN_DEG) break;
      controller.move(0, deg);
      lastCommand = { action: deg >= 0 ? 'left' : 'right', value: String(Math.abs(Math.round(deg))) };
      AIControlLoop.emit('commandExecuted', lastCommand);
      recentActions.push(`${lastCommand.action} ${lastCommand.value}`); while (recentActions.length > MAX_MEM) recentActions.shift();
      break;
    }
    case 'forward': {
      let mm = clamp(st.mm, FWD_MIN_MM, FWD_MAX_MM) ?? 0;
      if (mm < FWD_VISIBLE_MM) mm = FWD_VISIBLE_MM;
      controller.move(mm, 0);
      lastForwardTs = Date.now();
      lastCommand = { action: 'forward', value: String(Math.round(mm)) };
      AIControlLoop.emit('commandExecuted', lastCommand);
      recentActions.push(`forward ${Math.round(mm)}`); while (recentActions.length > MAX_MEM) recentActions.shift();
      break;
    }
    case 'backward': {
      const mm = clamp(st.mm, FWD_MIN_MM, FWD_MAX_MM) ?? 0;
      controller.move(-mm, 0);
      lastCommand = { action: 'backward', value: String(Math.round(mm)) };
      AIControlLoop.emit('commandExecuted', lastCommand);
      recentActions.push(`backward ${Math.round(mm)}`); while (recentActions.length > MAX_MEM) recentActions.shift();
      break;
    }
    case 'speak': {
      const text = (st.text || '').toString().trim();
      if (text) speak(text);
      break;
    }
    case 'set_goal': {
      const text = (st.text || '').toString().trim();
      if (text) { currentGoal = text; AIControlLoop.emit('goalSet', text); }
      break;
    }
    default: break;
  }
}

/* =========================
   Planner scheduler
========================= */
let planTimer = null;
let planQueued = false;
function requestPlanSoon(){ planQueued = true; }

function startPlanner() {
  if (planTimer) return;
  planTimer = setInterval(async () => {
    if (!loopRunning) return;

    // Need a plan if we have none, or TTL spent, or queued
    const need = (!activePlan || activePlan.ttl <= 0 || activePlan.idx >= activePlan.steps.length || planQueued);
    if (!need) return;
    planQueued = false;

    try {
      const plan = await requestPlan({});
      if (plan) {
        activePlan = plan;
        dlog('NEW PLAN:', activePlan);
      }
    } catch (e) {
      derr('requestPlan error:', e);
      AIControlLoop.emit('streamError', e);
    }
  }, PLAN_INTERVAL_MS);
}
function stopPlanner(){ if (planTimer) clearInterval(planTimer); planTimer = null; }

/* =========================
   Speech (flite)
========================= */
const speechQueue = [];
let isSpeaking = false;
function speak(text){
  speechQueue.push(String(text));
  processSpeechQueue();
}
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
   Public one-shot (compat) — uses provided image if any
========================= */
async function streamChatFromCameraImage(cameraImageBase64) {
  try {
    const img = (cameraImageBase64 && cameraImageBase64.length) ? cameraImageBase64 : null;
    dlog('streamChatFromCameraImage includeImage:', !!img);
    const plan = await requestPlan({ forceImage: !!img, overrideImageBase64: img });
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
    activePlan = null;
    plansSinceKeyframe = 0;
    lastForwardTs = 0;
    this.emit('aiModeStatus', true);
    dlog('AI loop START');

    startExecutor();
    startPlanner();
    requestPlanSoon(); // kick first plan
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    loopRunning = false;
    stopExecutor();
    stopPlanner();
    activePlan = null;
    lastResponse = '';
    this.emit('aiModeStatus', false);
    dlog('AI loop STOP');
  }
}
const AIControlLoop = new AIControlLoopClass();

/* =========================
   Params & goal (drop-in)
========================= */
async function setGoal(goal){ currentGoal = goal; dlog('setGoal:', goal); AIControlLoop.emit('goalSet', goal); requestPlanSoon(); }
function setParams(params){
  dlog('setParams:', params);
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined)       movingParams.top_k = params.top_k;
  if (params.top_p !== undefined)       movingParams.top_p = params.top_p;
  if (params.min_k !== undefined)       movingParams.min_k = params.min_k;
}
function getParams(){ return { ...movingParams }; }

/* =========================
   Compatibility shim exports
========================= */
module.exports = {
  streamChatFromCameraImage,
  AIControlLoop,
  speak,
  // If server.js calls this, treat commands as an immediate one-step plan
  runCommands: (cmds) => {
    dlog('runCommands (compat):', cmds);
    if (!Array.isArray(cmds) || !cmds.length) return;
    const c = cmds[0]; const v = parseFloat(c.value);
    if (c.action === 'left')      activePlan = { intent:null, steps:[{a:'turn',deg: Math.max(TURN_MIN_DEG, Math.min(TURN_MAX_DEG,  Math.abs(v)||TURN_MIN_DEG))}], ttl:3, ts:Date.now(), source:'compat', idx:0 };
    else if (c.action === 'right')activePlan = { intent:null, steps:[{a:'turn',deg:-Math.max(TURN_MIN_DEG, Math.min(TURN_MAX_DEG, Math.abs(v)||TURN_MIN_DEG))}], ttl:3, ts:Date.now(), source:'compat', idx:0 };
    else if (c.action === 'forward')  activePlan = { intent:null, steps:[{a:'forward',mm: Math.max(FWD_VISIBLE_MM, Math.min(FWD_MAX_MM, Math.abs(v)||FWD_VISIBLE_MM))}], ttl:3, ts:Date.now(), source:'compat', idx:0 };
    else if (c.action === 'backward') activePlan = { intent:null, steps:[{a:'backward',mm: Math.max(FWD_MIN_MM, Math.min(FWD_MAX_MM, Math.abs(v)||FWD_MIN_MM))}], ttl:3, ts:Date.now(), source:'compat', idx:0 };
  },
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; dlog('clearGoal'); AIControlLoop.emit('goalCleared'); requestPlanSoon(); },
  setParams,
  getParams,
};
