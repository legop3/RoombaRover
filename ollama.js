const { RoombaController } = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const { Ollama } = require('ollama');
const Jimp = require('jimp');
const roombaStatus = require('./roombaStatus');

const CAMERA_HEIGHT_MM = 80;
const CELL_SIZE = 200;
const WORLD_FILE = 'world-state.json';

const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });
const controller = new RoombaController(port);

let systemPrompt = fs.readFileSync('./prompts/system.txt', 'utf8').trim();

// --- tiny world model ----------------------------------------------------
let pose = { x: 0, y: 0, theta: 0 };
let worldMap = {};

function loadWorld() {
  try {
    const saved = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    pose = saved.pose || pose;
    worldMap = saved.worldMap || worldMap;
  } catch (_) {}
}

function saveWorld() {
  try {
    fs.writeFileSync(WORLD_FILE, JSON.stringify({ pose, worldMap }));
  } catch (err) {
    console.error('world save failed:', err.message);
  }
}

function markVisited() {
  const cx = Math.round(pose.x / CELL_SIZE);
  const cy = Math.round(pose.y / CELL_SIZE);
  const key = `${cx},${cy}`;
  if (!worldMap[key]) worldMap[key] = { visited: true, obstacle: false };
  else worldMap[key].visited = true;
  saveWorld();
}

function updateMapWithBumps() {
  if (roombaStatus.bumpSensors.bumpLeft === 'ON' || roombaStatus.bumpSensors.bumpRight === 'ON') {
    const rad = pose.theta * Math.PI / 180;
    const ox = pose.x + Math.cos(rad) * CELL_SIZE;
    const oy = pose.y + Math.sin(rad) * CELL_SIZE;
    const cx = Math.round(ox / CELL_SIZE);
    const cy = Math.round(oy / CELL_SIZE);
    const key = `${cx},${cy}`;
    if (!worldMap[key]) worldMap[key] = { visited: false, obstacle: true };
    else worldMap[key].obstacle = true;
    saveWorld();
  }
}

function updateMapWithLightBumps() {
  const angles = { LBL:75, LBFL:45, LBCL:15, LBCR:-15, LBFR:-45, LBR:-75 };
  for (const [sensor, val] of Object.entries(roombaStatus.lightBumps)) {
    if (val > 50) {
      const rad = (pose.theta + (angles[sensor]||0)) * Math.PI / 180;
      const ox = pose.x + Math.cos(rad) * CELL_SIZE;
      const oy = pose.y + Math.sin(rad) * CELL_SIZE;
      const cx = Math.round(ox / CELL_SIZE);
      const cy = Math.round(oy / CELL_SIZE);
      const key = `${cx},${cy}`;
      if (!worldMap[key]) worldMap[key] = { visited:false, obstacle:true };
      else worldMap[key].obstacle = true;
    }
  }
  saveWorld();
}

function getMapExcerpt(radius=2) {
  const ox = Math.round(pose.x / CELL_SIZE);
  const oy = Math.round(pose.y / CELL_SIZE);
  const rad = pose.theta * Math.PI / 180;
  const excerpt = [];
  for (let dx=-radius; dx<=radius; dx++) {
    for (let dy=-radius; dy<=radius; dy++) {
      const key = `${ox+dx},${oy+dy}`;
      const cell = worldMap[key] || {visited:false, obstacle:false};
      const wx = dx * CELL_SIZE;
      const wy = dy * CELL_SIZE;
      const forward = wx * Math.cos(rad) + wy * Math.sin(rad);
      const right = wx * Math.sin(rad) - wy * Math.cos(rad);
      excerpt.push({ forward_mm: Math.round(forward), right_mm: Math.round(right), visited:cell.visited, obstacle:cell.obstacle });
    }
  }
  return excerpt;
}

controller.on('roomba:done', ({ distanceMm, turnDeg }) => {
  pose.theta = (pose.theta + turnDeg) % 360;
  if (pose.theta < 0) pose.theta += 360;
  const rad = pose.theta * Math.PI / 180;
  pose.x += distanceMm * Math.cos(rad);
  pose.y += distanceMm * Math.sin(rad);
  markVisited();
});

loadWorld();
markVisited();

// --- helpers --------------------------------------------------------------
async function downscale(base64, w=160, h=120) {
  try {
    const img = await Jimp.read(Buffer.from(base64, 'base64'));
    img.resize(w, h).quality(60);
    return await img.getBase64Async(Jimp.MIME_JPEG);
  } catch (e) {
    console.error('downscale failed:', e.message);
    return base64;
  }
}

function speak(text) {
  if (!text) return;
  const proc = spawn('flite', ['-voice', 'rms', '-t', text]);
  proc.on('error', e => console.error('speech error:', e.message));
}

const defaultParams = {
  temperature: config.ollama.parameters.temperature || 0.7,
  top_k: config.ollama.parameters.top_k || 40,
  top_p: config.ollama.parameters.top_p || 0.9,
  min_k: config.ollama.parameters.min_k || 1,
  num_predict: config.ollama.parameters.num_predict || 256
};
let params = { ...defaultParams };

function buildState() {
  updateMapWithBumps();
  updateMapWithLightBumps();
  return {
    pose: { x: Math.round(pose.x), y: Math.round(pose.y), theta: Math.round(pose.theta) },
    map: getMapExcerpt(),
    bump_left: roombaStatus.bumpSensors.bumpLeft,
    bump_right: roombaStatus.bumpSensors.bumpRight,
    light_bumps: roombaStatus.lightBumps,
    current_goal,
    camera_height_mm: CAMERA_HEIGHT_MM
  };
}

async function requestPlan(state, image) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(state) }
  ];
  const opts = { model: config.ollama.modelName, messages, stream: false, options: params };
  if (image) opts.images = [image];
  try {
    const res = await ollama.chat(opts);
    const text = res.message?.content?.trim() || '{}';
    return JSON.parse(text);
  } catch (err) {
    console.error('ollama plan error:', err.message);
    return { say: '', plan: [] };
  }
}

function moveAndWait(dist, angle) {
  return new Promise(resolve => {
    controller.once('roomba:done', resolve);
    controller.move(dist, angle);
  });
}

async function executePlan(plan=[]) {
  for (const step of plan) {
    const action = (step.action || '').toLowerCase();
    switch(action) {
      case 'move':
        const d = parseFloat(step.distance_mm);
        if (!isNaN(d) && d !== 0) await moveAndWait(d, 0);
        break;
      case 'turn':
        const a = parseFloat(step.angle_deg);
        if (!isNaN(a) && a !== 0) await moveAndWait(0, a);
        break;
      case 'say':
        speak(step.text);
        break;
      case 'goal':
        current_goal = step.text || null;
        break;
      default:
        console.log('unknown plan step', step);
    }
  }
}

let current_goal = null;

class AIControlLoopClass extends EventEmitter {
  constructor(){ super(); this.running=false; }
  async start(){
    if (this.running) return;
    this.running = true;
    this.emit('aiModeStatus', true);
    tryWrite(port, [131]);
    while (this.running){
      const raw = getLatestFrontFrame();
      const image = raw ? await downscale(raw) : null;
      const state = buildState();
      const { say, plan } = await requestPlan(state, image);
      if (say) speak(say);
      await executePlan(plan);
    }
    this.emit('aiModeStatus', false);
  }
  stop(){ this.running=false; }
}

const AIControlLoop = new AIControlLoopClass();

function setParams(p){ Object.assign(params, p); }
function getParams(){ return { ...params }; }
function setGoal(g){ current_goal = g; }

module.exports = {
  AIControlLoop,
  speak,
  setParams,
  getParams,
  setGoal,
  getCurrentGoal: () => current_goal,
  getPose: () => ({...pose}),
  getMapExcerpt
};
