/* eslint-disable no-console */
// ======== HARD DEPENDENCIES (from your project) ========
const { RoombaController } = require('./roombaCommands');
const { port } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const roombaStatus = require('./roombaStatus');

// ======== SYSTEM & OS ========
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');

// ======== OLLAMA CLIENT (external server; CPU OK) ========
const { Ollama } = require('ollama');
const ollama = new Ollama({
  host: `${config?.ollama?.serverURL}:${config?.ollama?.serverPort}`,
});

// ======== DEBUG ========
const DEBUG = true;
const log  = (...a)=>DEBUG&&console.log('[OLLAMA]', ...a);
const warn = (...a)=>console.warn('[OLLAMA]', ...a);
const err  = (...a)=>console.error('[OLLAMA]', ...a);

// ======== SOCKET.IO (optional/global) ========
let io = null;
try { io = global.io || null; } catch { io = null; }
function emitIO(ev, payload){ try { if (io && typeof io.emit==='function') io.emit(ev, payload); } catch {} }

// ======== SAFE FILE READS (prompts) ========
function safeRead(p){ try { return fs.readFileSync(p,'utf8').trim(); } catch { return ''; } }
const chatPrompt       = safeRead('./prompts/chat.txt');
const systemPromptBase = safeRead('./prompts/system.txt');

// ======== CONTROLLER ========
const controller = new RoombaController(port);

// ======== PARAMETERS (unchanged shape) ========
const defaultParams = {
  temperature: config?.ollama?.parameters?.temperature ?? 0.2,
  top_k:       config?.ollama?.parameters?.top_k ?? 40,
  top_p:       config?.ollama?.parameters?.top_p ?? 0.9,
  min_k:       config?.ollama?.parameters?.min_k ?? 1,
};
let movingParams = { ...defaultParams };

// ======== STATE ========
let loopRunning = false;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;

// High-level: LLM-compiled finite state machine
// fsm = { initial: "STATE", horizon_s: 20, states: { STATE: { say?, do: [steps], on: [ {when, to} ] } } }
let fsm = null;
let fsmCompiledAt = 0;
let currentState = null;
let stepIndex = 0;

// Fast runtime trackers
let execTimer = null;      // interpreter loop
let plannerTimer = null;   // checks when to (re)compile
let lastForwardTs = 0;     // anti-dither
let lastTurnOnlyMs = 0;    // track turning time
let lastProgressTs = 0;    // when we last completed a "forward" action

// Light memory to feed into compiler
const recentActions = []; // "forward 200", "left 15", ...
const recentIntents = []; // e.g., "seeking doorway ahead"
const MAX_MEM = 8;

// Cadence / tunables
const EXEC_HZ            = 4;                     // interpreter loop
const EXEC_INTERVAL_MS   = Math.round(1000/EXEC_HZ);
const REPLAN_MIN_S       = 10;                    // compile FSM at least this far apart
const REPLAN_MAX_S       = 25;                    // force recompile after this
const ANTI_DITHER_MS     = 2500;                  // if turning this long, enforce forward
const KEYFRAME_EVERY_COMPILE = 1;                 // include image every compile (still CPU-friendly)

// Movement clamps
const TURN_MIN_DEG = 8,  TURN_MAX_DEG = 45;
const FWD_MIN_MM   = 40, FWD_MAX_MM   = 300, FWD_VISIBLE_MM = 140;

// LLM budget & stops
const NUM_PREDICT_FSM = 256; // compact JSON, but enough for small FSM
const STOP_SEQS = ['[[END]]','STOP','[['];

// ======== HELPERS ========
function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(lo, Math.min(hi, x));
}
function pushRecent(list, s) {
  if (!s) return;
  list.push(s);
  while (list.length > MAX_MEM) list.shift();
}
function packLightBumps() {
  const lb = roombaStatus?.lightBumps || {};
  return {
    LBL:  lb.LBL ?? 0, LBFL: lb.LBFL ?? 0, LBCL: lb.LBCL ?? 0,
    LBCR: lb.LBCR ?? 0, LBFR: lb.LBFR ?? 0, LBR:  lb.LBR ?? 0
  };
}
function sensorSummary() {
  const bumpL = !!(roombaStatus?.bumpSensors?.bumpLeft);
  const bumpR = !!(roombaStatus?.bumpSensors?.bumpRight);
  const lb = packLightBumps();
  const leftSum   = (lb.LBL||0)+(lb.LBFL||0)+(lb.LBCL||0);
  const rightSum  = (lb.LBR||0)+(lb.LBFR||0)+(lb.LBCR||0);
  const centerSum = (lb.LBCL||0)+(lb.LBCR||0);
  return { bumpL, bumpR, lb, leftSum, rightSum, centerSum };
}
function memoryLine() {
  return {
    acts: recentActions.slice(-MAX_MEM),
    intents: recentIntents.slice(-MAX_MEM)
  };
}
function latestFrame(include) {
  if (!include) return null;
  try { return getLatestFrontFrame(); } catch { return null; }
}

// ======== FSM COMPILER (LLM) ========
function buildSystemPromptFSM() {
  return (
    systemPromptBase + '\n\n' +
    'ROLE: You are a navigation “director”. Compile a SMALL FINITE STATE MACHINE (FSM) that runs for ~10–25 seconds.\n' +
    'INPUTS: one forward camera frame (egocentric) + bumpers + six light-bump readings + tiny memory.\n' +
    'GOAL: Move safely & purposefully toward interesting/open space (or stated goal), narrating intent briefly.\n' +
    'STRICT OUTPUT: a single JSON object ONLY (no prose) with this schema:\n' +
    '{\n' +
    '  "initial": "STATE_NAME",\n' +
    '  "horizon_s":  between 10 and 25,\n' +
    '  "states": {\n' +
    '     "STATE_NAME": {\n' +
    '        "say": "short intent phrase (optional)",\n' +
    '        "do": [  // 1..5 compact steps executed in order, then repeat if still in state\n' +
    '          {"a":"forward","mm":140..300} | {"a":"back","mm":120..300} |\n' +
    '          {"a":"left","deg":8..45}      | {"a":"right","deg":8..45}  |\n' +
    '          {"a":"wait","ms":150..600}    | {"a":"speak","text":"..."}\n' +
    '        ],\n' +
    '        "on": [ // transitions checked each tick\n' +
    '          {"when":"bump_left","to":"STATE"}, {"when":"bump_right","to":"STATE"},\n' +
    '          {"when":"center_blocked","to":"STATE"}, {"when":"clear_ahead","to":"STATE"},\n' +
    '          {"when":"left_heavier","to":"STATE"}, {"when":"right_heavier","to":"STATE"},\n' +
    '          {"when":"stuck","to":"STATE"}, {"when":"always","to":"STATE"}\n' +
    '        ]\n' +
    '     }, ...\n' +
    '  }\n' +
    '}\n' +
    'CONSTRAINTS:\n' +
    '- Keep 2–5 states. Keep steps decisive (no 1°/5mm dithers). Favor patterns like: small scan -> forward stride.\n' +
    '- If any bumper ON, have a state that backs & yaws away before continuing.\n' +
    '- If center appears open, prefer a forward stride 140–220 mm.\n' +
    '- Use short intents (say) so the operator hears the plan (“following wall left”, etc.).\n' +
    'NO CODE FENCES. JSON ONLY.\n'
  );
}
function buildUserPromptFSM(forceImage, overrideImageBase64=null) {
  const s = sensorSummary();
  const goal = currentGoal || 'Explore safely; improve view when uncertain.';
  const mem = memoryLine();
  const body = {
    ts: Date.now(),
    goal,
    bumpers: { left: s.bumpL, right: s.bumpR },
    light_bumps: s.lb,
    recent: mem,
    note: chatPrompt || ''
  };
  const msg = { role: 'user', content: JSON.stringify(body) };

  // attach image
  const frame = overrideImageBase64 || latestFrame(forceImage);
  const payload = { ts: Date.now(), bytes: 0, included: false };
  if (frame && frame.length) {
    const clean = frame.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
    msg.images = [clean];
    payload.bytes = Buffer.byteLength(clean, 'base64');
    payload.included = true;
  }
  // notify UI regardless
  emitIO('cameraFrameCaptured', payload);
  AIControlLoop.emit('cameraFrameCaptured', payload);
  return msg;
}
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
async function compileFSM({ forceImage=false, overrideImageBase64=null } = {}) {
  log('---- compileFSM ---- image:', forceImage, 'goal:', currentGoal || '(none)');
  const response = await ollama.chat({
    model: config?.ollama?.modelName,
    messages: [
      { role: 'system', content: buildSystemPromptFSM() },
      buildUserPromptFSM(forceImage, overrideImageBase64)
    ],
    stream: true,
    keep_alive: -1,
    format: 'json',
    options: {
      temperature: movingParams.temperature,
      top_k: movingParams.top_k,
      top_p: movingParams.top_p,
      min_k: movingParams.min_k,
      num_predict: NUM_PREDICT_FSM,
      stop: STOP_SEQS,
    }
  });

  let raw = '';
  let parsed = null;
  for await (const part of response) {
    const chunk = part?.message?.content || '';
    if (!chunk) continue;
    raw += chunk;
    AIControlLoop.emit('streamChunk', chunk);
    // try early JSON
    if (!parsed) {
      const jsonSlice = extractFirstJSONObject(raw);
      if (jsonSlice) {
        try { parsed = JSON.parse(jsonSlice); } catch { /* wait for more */ }
      }
    }
  }
  AIControlLoop.emit('responseComplete', raw);
  lastResponse = raw;

  if (!parsed) {
    const jsonSlice = extractFirstJSONObject(raw);
    if (jsonSlice) { try { parsed = JSON.parse(jsonSlice); } catch (e) { warn('FSM JSON parse failed:', e?.message || e); } }
  }

  if (!parsed) {
    warn('FSM compile failed — using fallback');
    return fallbackFSM();
  }
  return normalizeFSM(parsed);
}
function normalizeFSM(spec) {
  // minimal validation + clamping
  const out = { initial: null, horizon_s: 15, states: {} };
  out.initial = String(spec.initial || '').trim() || 'EXPLORE';
  out.horizon_s = Math.max(REPLAN_MIN_S, Math.min(REPLAN_MAX_S, parseInt(spec.horizon_s || 15,10) || 15));

  const states = spec.states || {};
  for (const k of Object.keys(states)) {
    const st = states[k] || {};
    const name = String(k);
    const say = st.say ? String(st.say) : null;
    const doSteps = Array.isArray(st.do) ? st.do.slice(0,5) : [];
    const onTrans = Array.isArray(st.on) ? st.on.slice(0,8) : [];

    const normSteps = [];
    for (const step of doSteps) {
      const a = String(step?.a || '').toLowerCase();
      if (a === 'forward') {
        let mm = clamp(step.mm, FWD_MIN_MM, FWD_MAX_MM) ?? 0;
        if (mm < FWD_VISIBLE_MM) mm = FWD_VISIBLE_MM;
        normSteps.push({ a:'forward', mm: Math.round(mm) });
      } else if (a === 'back') {
        let mm = clamp(step.mm, FWD_MIN_MM, FWD_MAX_MM) ?? 120;
        normSteps.push({ a:'back', mm: Math.round(mm) });
      } else if (a === 'left' || a === 'right') {
        let deg = clamp(step.deg, TURN_MIN_DEG, TURN_MAX_DEG) ?? TURN_MIN_DEG;
        if (a === 'right') deg = -Math.abs(deg); // right is negative yaw
        else deg = Math.abs(deg);
        normSteps.push({ a:'turn', deg: Math.round(deg) });
      } else if (a === 'wait') {
        let ms = clamp(step.ms, 100, 800) ?? 200;
        normSteps.push({ a:'wait', ms: Math.round(ms) });
      } else if (a === 'speak') {
        const txt = String(step.text || '').trim();
        if (txt) normSteps.push({ a:'speak', text: txt });
      }
    }
    if (!normSteps.length) normSteps.push({ a:'turn', deg: 15 }, { a:'forward', mm: 180 });

    const normOn = [];
    const validConds = new Set(['bump_left','bump_right','center_blocked','clear_ahead','left_heavier','right_heavier','stuck','always']);
    for (const tr of onTrans) {
      const when = String(tr?.when || '').toLowerCase();
      const to   = String(tr?.to || '').trim();
      if (validConds.has(when) && to) normOn.push({ when, to });
    }
    // Add default escape on bump if missing
    const hasBump = normOn.some(t => t.when==='bump_left' || t.when==='bump_right');
    if (!hasBump) normOn.push({ when:'bump_left', to: name }); // self-loop will be corrected by interpreter
    out.states[name] = { say, do: normSteps, on: normOn };
  }

  if (!out.states[out.initial]) {
    const first = Object.keys(out.states)[0] || 'EXPLORE';
    out.initial = first;
  }

  // announce intent for initial state
  if (out.states[out.initial]?.say) {
    const phrase = out.states[out.initial].say;
    pushRecentIntent(phrase);
    emitIO('intentUpdate', { ts: Date.now(), text: `[[INTENT]] ${phrase}` });
    AIControlLoop.emit('intentUpdate', { ts: Date.now(), text: `[[INTENT]] ${phrase}` });
    speak(phrase);
  }

  log('FSM normalized:', JSON.stringify(out));
  return out;
}
function fallbackFSM() {
  // Simple wall-avoid + sweep
  return normalizeFSM({
    initial: 'SWEEP',
    horizon_s: 15,
    states: {
      SWEEP: {
        say: 'sweeping forward',
        do: [ {a:'left',deg:12}, {a:'forward',mm:200} ],
        on: [
          { when:'bump_left', to:'ESCAPE_LEFT' },
          { when:'bump_right', to:'ESCAPE_RIGHT' },
          { when:'center_blocked', to:'SCAN' }
        ]
      },
      SCAN: {
        say: 'scanning center',
        do: [ {a:'left',deg:15}, {a:'wait',ms:200}, {a:'right',deg:30}, {a:'wait',ms:200}, {a:'left',deg:15} ],
        on: [
          { when:'clear_ahead', to:'SWEEP' },
          { when:'stuck', to:'SWEEP' },
          { when:'always', to:'SWEEP' }
        ]
      },
      ESCAPE_LEFT: {
        say: 'avoiding left obstacle',
        do: [ {a:'back',mm:160}, {a:'right',deg:20}, {a:'forward',mm:180} ],
        on: [ { when:'always', to:'SWEEP' } ]
      },
      ESCAPE_RIGHT: {
        say: 'avoiding right obstacle',
        do: [ {a:'back',mm:160}, {a:'left',deg:20}, {a:'forward',mm:180} ],
        on: [ { when:'always', to:'SWEEP' } ]
      }
    }
  });
}

// ======== CONDITION EVAL (for transitions) ========
function evalConds() {
  const s = sensorSummary();
  const clearAhead = s.centerSum < 35;           // tune as needed
  const centerBlocked = s.centerSum >= 35;
  const leftHeavier  = s.leftSum > s.rightSum + 5;
  const rightHeavier = s.rightSum > s.leftSum + 5;
  const stuck = (Date.now() - lastForwardTs) > ANTI_DITHER_MS;
  return {
    bump_left: s.bumpL,
    bump_right: s.bumpR,
    center_blocked: centerBlocked,
    clear_ahead: clearAhead,
    left_heavier: leftHeavier,
    right_heavier: rightHeavier,
    stuck,
    always: true,
  };
}

// ======== INTERPRETER ========
let stepCooldown = false;

function executeStep(step) {
  if (!step) return;
  stepCooldown = true;
  setTimeout(()=>{ stepCooldown=false; }, 150);

  switch (step.a) {
    case 'turn': {
      const deg = clamp(step.deg, -TURN_MAX_DEG, TURN_MAX_DEG) ?? 0;
      if (Math.abs(deg) < TURN_MIN_DEG) return;
      controller.move(0, deg);
      lastCommand = { action: deg >= 0 ? 'left' : 'right', value: String(Math.abs(Math.round(deg))) };
      AIControlLoop.emit('commandExecuted', lastCommand);
      pushRecent(recentActions, `${lastCommand.action} ${lastCommand.value}`);
      break;
    }
    case 'forward': {
      let mm = clamp(step.mm, FWD_MIN_MM, FWD_MAX_MM) ?? FWD_VISIBLE_MM;
      if (mm < FWD_VISIBLE_MM) mm = FWD_VISIBLE_MM;
      controller.move(mm, 0);
      lastForwardTs = Date.now();
      lastCommand = { action:'forward', value:String(Math.round(mm)) };
      AIControlLoop.emit('commandExecuted', lastCommand);
      pushRecent(recentActions, `forward ${Math.round(mm)}`);
      break;
    }
    case 'back': {
      const mm = clamp(step.mm, FWD_MIN_MM, FWD_MAX_MM) ?? 140;
      controller.move(-mm, 0);
      lastCommand = { action:'backward', value:String(Math.round(mm)) };
      AIControlLoop.emit('commandExecuted', lastCommand);
      pushRecent(recentActions, `backward ${Math.round(mm)}`);
      break;
    }
    case 'wait': {
      // no motion, small delay handled by cooldown
      break;
    }
    case 'speak': {
      const text = String(step.text || '').trim();
      if (text) speak(text);
      break;
    }
    default: break;
  }
}

function advanceStateIfNeeded() {
  if (!fsm || !currentState) return;
  const st = fsm.states[currentState];
  if (!st) return;

  // Transition check
  const conds = evalConds();
  const trans = st.on || [];
  for (const t of trans) {
    if (t && conds[t.when]) {
      if (t.to && fsm.states[t.to]) {
        if (t.to !== currentState) {
          // entering new state -> announce
          const say = fsm.states[t.to].say;
          if (say) {
            pushRecent(recentIntents, say);
            emitIO('intentUpdate', { ts: Date.now(), text: `[[INTENT]] ${say}` });
            AIControlLoop.emit('intentUpdate', { ts: Date.now(), text: `[[INTENT]] ${say}` });
            speak(say);
          }
          currentState = t.to;
          stepIndex = 0;
          log('FSM ->', currentState);
        }
        break;
      }
    }
  }
}

function startInterpreter() {
  if (execTimer) return;
  execTimer = setInterval(() => {
    if (!loopRunning) return;
    if (!fsm || !currentState) return;

    // Safety: bumper reflex overrides one tick and triggers recompile soon
    const s = sensorSummary();
    if (s.bumpL || s.bumpR) {
      log('BUMP reflex: back & yaw');
      if (s.bumpL && !s.bumpR) controller.move(-160, -20);
      else if (s.bumpR && !s.bumpL) controller.move(-160, +20);
      else controller.move(-180, +20);
      pushRecent(recentActions, 'backward 160');
      requestCompileSoon(true);
      return;
    }

    // Anti-dither: if no forward for too long, force one stride
    if ((Date.now() - lastForwardTs) > ANTI_DITHER_MS) {
      log('ANTI-DITHER: force forward stride');
      controller.move(FWD_VISIBLE_MM, 0);
      lastForwardTs = Date.now();
      pushRecent(recentActions, `forward ${FWD_VISIBLE_MM}`);
      return;
    }

    if (stepCooldown) return;

    const st = fsm.states[currentState];
    if (!st || !Array.isArray(st.do) || st.do.length === 0) return;

    // Execute one step, then cycle
    const step = st.do[stepIndex % st.do.length];
    executeStep(step);
    stepIndex = (stepIndex + 1) % Math.max(1, st.do.length);

    // After action, evaluate transitions quickly
    advanceStateIfNeeded();

  }, EXEC_INTERVAL_MS);
}
function stopInterpreter(){ if (execTimer) clearInterval(execTimer); execTimer = null; }

// ======== PLANNER SCHEDULER (decides when to recompile) ========
let compileQueued = false;
function requestCompileSoon(force=false) { compileQueued = compileQueued || force; }

function shouldRecompile() {
  if (!fsm) return true;
  const ageS = (Date.now() - fsmCompiledAt) / 1000;
  if (ageS >= fsm.horizon_s) return true;
  if (ageS >= REPLAN_MAX_S)  return true;
  return compileQueued;
}

function startPlanner() {
  if (plannerTimer) return;
  plannerTimer = setInterval(async () => {
    if (!loopRunning) return;
    if (!shouldRecompile()) return;
    compileQueued = false;

    try {
      const useImage = true; // keyframe every compile
      const compiled = await compileFSM({ forceImage: useImage });
      fsm = compiled;
      fsmCompiledAt = Date.now();
      currentState = fsm.initial;
      stepIndex = 0;
      log('FSM COMPILED -> initial:', currentState, '| horizon_s:', fsm.horizon_s);
    } catch (e) {
      err('compileFSM error:', e);
      AIControlLoop.emit('streamError', e);
      // keep previous or fallback
      if (!fsm) { fsm = fallbackFSM(); currentState = fsm.initial; stepIndex = 0; }
    }
  }, 500); // check twice per second; compiles are infrequent
}
function stopPlanner(){ if (plannerTimer) clearInterval(plannerTimer); plannerTimer = null; }

// ======== SPEECH ========
const speechQueue = [];
let speaking = false;
function speak(text) {
  speechQueue.push(String(text));
  processSpeechQueue();
}
function processSpeechQueue() {
  if (speaking || speechQueue.length === 0) return;
  const t = speechQueue.shift();
  log('SAY:', t);
  const fl = spawn('flite', ['-voice','rms','-t', t]);
  speaking = true;
  const done = () => { speaking = false; processSpeechQueue(); };
  fl.on('close', done); fl.on('exit', done); fl.on('error', () => done());
}

// ======== PUBLIC API (DROP-IN) ========
async function streamChatFromCameraImage(cameraImageBase64) {
  // Keep this as a “compile now with provided frame” entry point
  try {
    const img = (cameraImageBase64 && cameraImageBase64.length) ? cameraImageBase64 : null;
    const compiled = await compileFSM({ forceImage: !!img, overrideImageBase64: img });
    fsm = compiled;
    fsmCompiledAt = Date.now();
    currentState = fsm.initial;
    stepIndex = 0;
    log('ONE-SHOT FSM COMPILED ->', currentState);
    return lastResponse;
  } catch (e) {
    err('streamChatFromCameraImage error:', e);
    AIControlLoop.emit('streamError', e);
    throw e;
  }
}

class AIControlLoopClass extends EventEmitter {
  constructor(){ super(); this.isRunning = false; }

  async start() {
    if (this.isRunning) { log('AI loop already running'); return; }
    this.isRunning = true;
    loopRunning = true;
    lastForwardTs = 0;
    this.emit('aiModeStatus', true);
    log('AI loop START');

    // compile immediately with a keyframe
    try {
      fsm = await compileFSM({ forceImage: true });
      fsmCompiledAt = Date.now();
      currentState = fsm.initial;
      stepIndex = 0;
      log('FSM initial:', currentState, 'horizon_s:', fsm.horizon_s);
    } catch (e) {
      err('initial compile error:', e);
      fsm = fallbackFSM();
      fsmCompiledAt = Date.now();
      currentState = fsm.initial;
      stepIndex = 0;
    }

    startInterpreter();
    startPlanner();
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    loopRunning = false;
    stopInterpreter();
    stopPlanner();
    this.emit('aiModeStatus', false);
    lastResponse = '';
    log('AI loop STOP');
  }
}
const AIControlLoop = new AIControlLoopClass();

// ======== GOAL & PARAMS (unchanged) ========
async function setGoal(goal) {
  currentGoal = goal;
  log('setGoal:', goal);
  AIControlLoop.emit('goalSet', goal);
  requestCompileSoon(true);
}
function setParams(params){
  log('setParams:', params);
  if (params.temperature !== undefined) movingParams.temperature = params.temperature;
  if (params.top_k !== undefined)       movingParams.top_k = params.top_k;
  if (params.top_p !== undefined)       movingParams.top_p = params.top_p;
  if (params.min_k !== undefined)       movingParams.min_k = params.min_k;
}
function getParams(){ return { ...movingParams }; }

// ======== COMPAT SHIM ========
module.exports = {
  streamChatFromCameraImage,
  AIControlLoop,
  speak,
  runCommands: (cmds) => {
    // Keep compatibility: treat commands as a tiny, immediate state
    log('runCommands (compat):', cmds);
    if (!Array.isArray(cmds) || !cmds.length) return;
    const c = cmds[0];
    let st = { do: [], on: [ { when:'always', to:'USER_NEXT' } ], say: 'manual micro' };
    if (c.action === 'left')     st.do.push({ a:'turn', deg: Math.max(TURN_MIN_DEG, Math.min(TURN_MAX_DEG, Math.abs(parseFloat(c.value)||TURN_MIN_DEG))) });
    if (c.action === 'right')    st.do.push({ a:'turn', deg: -Math.max(TURN_MIN_DEG, Math.min(TURN_MAX_DEG, Math.abs(parseFloat(c.value)||TURN_MIN_DEG))) });
    if (c.action === 'forward')  st.do.push({ a:'forward', mm: Math.max(FWD_VISIBLE_MM, Math.min(FWD_MAX_MM, Math.abs(parseFloat(c.value)||FWD_VISIBLE_MM))) });
    if (c.action === 'backward') st.do.push({ a:'back', mm: Math.max(FWD_MIN_MM, Math.min(FWD_MAX_MM, Math.abs(parseFloat(c.value)||FWD_MIN_MM))) });

    fsm = { initial:'USER_NOW', horizon_s: 8, states:{
      USER_NOW: st,
      USER_NEXT: { do:[{a:'forward',mm: FWD_VISIBLE_MM}], on:[{when:'always', to:'USER_NEXT'}] }
    }};
    currentState = 'USER_NOW'; stepIndex = 0; fsmCompiledAt = Date.now();
  },
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => { currentGoal = null; log('clearGoal'); AIControlLoop.emit('goalCleared'); requestCompileSoon(true); },
  setParams,
  getParams,
};
