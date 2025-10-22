// services/mediamtxManager.js
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const config = require('../helpers/config');
const { createLogger } = require('../helpers/logger');
const { io } = require('../globals/wsSocketExpress');

const logger = createLogger('MediaMTX');

// --- Config (kept minimal; uses your known-good defaults) ---
const CAMERA_DEVICE_PATH = (config.mediamtx && config.mediamtx.cameraDevicePath) || '/dev/video2';
const AUDIO_DEVICE_ALSA  = (config.mediamtx && config.mediamtx.audioDevice)     || 'hw:2,0';
const STREAM_NAME        = (config.mediamtx && config.mediamtx.streamName)      || 'rover-video';

const WEBRTC_UDP = (config.mediamtx && config.mediamtx.webrtcUdpPort) || 8189;
const WEBRTC_TCP = (config.mediamtx && config.mediamtx.webrtcTcpPort) || 8189;
const ADDITIONAL_HOSTS = (config.mediamtx && Array.isArray(config.mediamtx.additionalHosts) && config.mediamtx.additionalHosts.length
  ? config.mediamtx.additionalHosts
  : ['rover.otter.land', '184.58.6.151', '192.168.0.173', 'otter.land']);

const MEDIAMTX_BINARY_PATH = (config.mediamtx && config.mediamtx.binaryPath) || 'mediamtx';
const FFMPEG_BINARY_PATH   = (config.mediamtx && config.mediamtx.ffmpegPath) || 'ffmpeg';
const CONFIG_DIR           = (config.mediamtx && config.mediamtx.configDir)  || path.join(process.cwd(), 'runtime');
const AUTO_START           = !!(config.mediamtx && config.mediamtx.autoStart);
const RUN_LOCAL            = config.mediamtx?.runLocal !== false;

const EXTERNAL_CFG_RAW = config.mediamtx?.external || null;
const SRT_CFG_RAW = EXTERNAL_CFG_RAW?.srt || null;
const REMOTE_CFG_RAW = EXTERNAL_CFG_RAW?.remoteConfig || null;

const REMOTE_CONFIG_PATH = (() => {
  if (!REMOTE_CFG_RAW?.outputPath) return null;
  const outPath = REMOTE_CFG_RAW.outputPath;
  return path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
})();

const HTTP_PORT = 8889; // mediamtx default
const RTSP_PORT = 8554; // mediamtx default
const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
  'stun:global.stun.twilio.com:3478',
];

function formatAudioBitrate(value, fallback = '96k') {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1000 && value % 1000 === 0) return `${Math.round(value / 1000)}k`;
    return String(value);
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function formatBindAddress(value, fallback) {
  if (value === undefined || value === null || value === '') {
    if (typeof fallback === 'number') return `:${fallback}`;
    return fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `:${value}`;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      if (typeof fallback === 'number') return `:${fallback}`;
      return fallback;
    }
    if (/^\d+$/.test(trimmed)) return `:${trimmed}`;
    return trimmed;
  }
  if (typeof fallback === 'number') return `:${fallback}`;
  return fallback;
}

function prepareSrtSettings(raw) {
  if (!raw) return { enabled: false, error: 'SRT publish target not configured' };
  const errors = [];
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  if (!host) errors.push('host');
  let port = raw.port;
  if (typeof port === 'string') port = port.trim();
  port = Number(port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) errors.push('port');
  const streamId = raw.streamId ? String(raw.streamId) : STREAM_NAME;
  const latencyMsRaw = raw.latencyMs ?? 120;
  const latencyMs = Number(latencyMsRaw);
  if (!Number.isFinite(latencyMs) || latencyMs < 0) errors.push('latencyMs');
  const mode = raw.mode ? String(raw.mode) : 'caller';
  const passphrase = raw.passphrase ? String(raw.passphrase) : '';
  const pbKeyLen = raw.pbKeyLen !== undefined ? Number(raw.pbKeyLen) : undefined;
  const audioBitrate = formatAudioBitrate(raw.audioBitrate ?? 96000);
  if (errors.length) {
    return {
      enabled: false,
      error: `Invalid SRT configuration: missing/invalid ${errors.join(', ')}`,
    };
  }
  return {
    enabled: true,
    host,
    port,
    streamId,
    latencyMs,
    mode,
    passphrase,
    pbKeyLen: Number.isInteger(pbKeyLen) ? pbKeyLen : undefined,
    audioBitrate,
  };
}

const SRT_CONFIG = prepareSrtSettings(SRT_CFG_RAW);
const USE_SRT_PUBLISH = !RUN_LOCAL && SRT_CONFIG.enabled && !SRT_CONFIG.error;

logger.info(`Using MediaMTX binary: ${MEDIAMTX_BINARY_PATH}`);
logger.info(`Using FFMPEG binary: ${FFMPEG_BINARY_PATH}`);
logger.info(`Using camera device: ${CAMERA_DEVICE_PATH}`);
logger.info(`Using audio device: ${AUDIO_DEVICE_ALSA}`);
logger.info(`MediaMTX mode: ${RUN_LOCAL ? 'local (managed by rover)' : 'external (SRT publish)'}`);
if (SRT_CONFIG.error) {
  logger.warn(SRT_CONFIG.error);
}
if (USE_SRT_PUBLISH) {
  logger.info(`SRT target: ${SRT_CONFIG.host}:${SRT_CONFIG.port} (streamId=${SRT_CONFIG.streamId}, latency=${SRT_CONFIG.latencyMs}ms)`);
}

// --- Internal state ---
let mediamtxProcess = null;
let ffmpegProcess = null;

const state = {
  mediamtx: {
    running: false,
    pid: null,
    startedAt: null,
    lastError: null,
    mode: RUN_LOCAL ? 'local' : 'external',
    disabled: !RUN_LOCAL,
  },
  ffmpeg:   { running: false, pid: null, startedAt: null, lastError: null }
};

function updateMediaState(patch) {
  state.mediamtx = { ...state.mediamtx, ...patch };
}
function updateFfState(patch) {
  state.ffmpeg = { ...state.ffmpeg, ...patch };
}

// Backoff schedulers
const sched = {
  mtx: { timer: null, attempt: 0 },
  ff:  { timer: null, attempt: 0 },
};

function emitStatus() {
  io.emit('mediamtx:status', { ...state.mediamtx });
  io.emit('ffmpeg:status',   { ...state.ffmpeg });
}
function emitLog(ch, line) { io.emit(`${ch}:log`, String(line)); }
function emitErr(ch, msg)  { io.emit(`${ch}:error`, String(msg)); }

function clearTimer(which) {
  if (sched[which].timer) { clearTimeout(sched[which].timer); sched[which].timer = null; }
}

function backoff(which, fn) {
  clearTimer(which);
  const a = ++sched[which].attempt;
  const base = 600; // ms
  const max  = 10000;
  const delay = Math.min(max, Math.floor(base * Math.pow(1.8, a)));
  const jitter = Math.floor(Math.random() * 250);
  sched[which].timer = setTimeout(() => {
    sched[which].timer = null;
    fn().catch(() => {}); // swallow, we’ll reschedule internally
  }, delay + jitter);
}

// Guard multiple awaits
function waitForTcp(host, port, timeoutMs = 12000, intervalMs = 150) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const s = new net.Socket();
      let done = false;
      s.once('connect', () => { done = true; s.destroy(); resolve(); });
      s.once('error', () => {
        if (done) return;
        s.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Timeout waiting for ${host}:${port}`));
        else setTimeout(tryOnce, intervalMs);
      });
      s.setTimeout(intervalMs, () => { if (!done) { s.destroy(); setTimeout(tryOnce, intervalMs); } });
      try { s.connect(port, host); } catch { setTimeout(tryOnce, intervalMs); }
    };
    tryOnce();
  });
}

// --- Config file generation (exact semantics you provided) ---
function buildMTXYamlExact() {
  const hosts = ADDITIONAL_HOSTS.map(h => `"${h}"`).join(', ');
  return `# Generated by mediamtxManager.js

webrtcLocalUDPAddress: :${WEBRTC_UDP}
webrtcLocalTCPAddress: :${WEBRTC_TCP}
webrtcAdditionalHosts: [ ${hosts} ]

webrtcICEServers2:
  - url: stun:stun.l.google.com:19302
  - url: stun:stun.cloudflare.com:3478
  - url: stun:global.stun.twilio.com:3478


# httpAddress: :${HTTP_PORT}
# webrtcAddress: :${HTTP_PORT}
# rtspAddress: :${RTSP_PORT}

paths:
  all:
    source: publisher
`;
}

function buildExternalMTXYaml() {
  const hostsSource = Array.isArray(REMOTE_CFG_RAW?.additionalHosts) && REMOTE_CFG_RAW.additionalHosts.length
    ? REMOTE_CFG_RAW.additionalHosts
    : ADDITIONAL_HOSTS;
  const hosts = hostsSource.map(h => `"${h}"`).join(', ');
  const stunList = (Array.isArray(REMOTE_CFG_RAW?.stunServers) && REMOTE_CFG_RAW.stunServers.length
    ? REMOTE_CFG_RAW.stunServers
    : DEFAULT_STUN_SERVERS).map(url => `  - url: ${url}`).join('\n');
  const udpAddress = formatBindAddress(REMOTE_CFG_RAW?.webrtcUdpPort, WEBRTC_UDP);
  const tcpAddress = formatBindAddress(REMOTE_CFG_RAW?.webrtcTcpPort, WEBRTC_TCP);
  const httpAddress = formatBindAddress(REMOTE_CFG_RAW?.httpAddress, `:${HTTP_PORT}`);
  const webrtcAddress = formatBindAddress(REMOTE_CFG_RAW?.webrtcAddress, `:${HTTP_PORT}`);
  const rtspAddress = formatBindAddress(REMOTE_CFG_RAW?.rtspAddress, `:${RTSP_PORT}`);
  const srtFallback = SRT_CONFIG.enabled ? `:${SRT_CONFIG.port}` : ':8890';
  const srtAddress = formatBindAddress(REMOTE_CFG_RAW?.srtAddress, srtFallback);

  return `# Generated by RoombaRover (external MediaMTX configuration)

webrtcLocalUDPAddress: ${udpAddress}
webrtcLocalTCPAddress: ${tcpAddress}
webrtcAdditionalHosts: [ ${hosts} ]

webrtcICEServers2:
${stunList}

httpAddress: ${httpAddress}
webrtcAddress: ${webrtcAddress}
rtspAddress: ${rtspAddress}
srtAddress: ${srtAddress}

paths:
  ${STREAM_NAME}:
    source: publisher
`;
}

function writeExternalConfigIfNeeded() {
  if (!REMOTE_CONFIG_PATH) return;
  try {
    fs.mkdirSync(path.dirname(REMOTE_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(REMOTE_CONFIG_PATH, buildExternalMTXYaml(), 'utf8');
    logger.info(`External MediaMTX config written to ${REMOTE_CONFIG_PATH}`);
  } catch (e) {
    const msg = `Failed to write external MediaMTX config: ${e.message}`;
    logger.error(msg);
    emitErr('mediamtx', msg);
  }
}

function safeWriteMTXConfig() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const cfgPath = path.join(CONFIG_DIR, 'mediamtx.yml');
    fs.writeFileSync(cfgPath, buildMTXYamlExact(), 'utf8');
    return cfgPath;
  } catch (e) {
    const msg = `Failed to write mediamtx.yml: ${e.message}`;
    logger.error(msg);
    emitErr('mediamtx', msg);
    return null;
  }
}

// --- Start/Stop MediaMTX (fail-safe) ---
async function startMediaMTX() {
  if (!RUN_LOCAL) {
    logger.debug('startMediaMTX() skipped: external MediaMTX mode is enabled.');
    updateMediaState({ running: false, pid: null, startedAt: null, lastError: null });
    emitStatus();
    return;
  }
  // If already running or starting, no-op
  if (mediamtxProcess || state.mediamtx.running) return;

  clearTimer('mtx');
  updateMediaState({ lastError: null });
  emitStatus();

  const cfgPath = safeWriteMTXConfig();
  if (!cfgPath) {
    updateMediaState({ lastError: 'config-write-failed' });
    emitStatus();
    backoff('mtx', startMediaMTX);
    return;
  }

  let child;
  try {
    logger.info(`Starting MediaMTX with ${cfgPath}`);
    child = spawn(MEDIAMTX_BINARY_PATH, [cfgPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = e && e.code === 'ENOENT'
      ? `MediaMTX binary not found: ${MEDIAMTX_BINARY_PATH}`
      : `Failed to spawn MediaMTX: ${e.message}`;
    logger.error(msg);
    updateMediaState({ lastError: msg });
    emitErr('mediamtx', msg);
    emitStatus();
    backoff('mtx', startMediaMTX);
    return;
  }

  mediamtxProcess = child;
  updateMediaState({ running: true, pid: child.pid, startedAt: Date.now(), lastError: null });
  emitStatus();

  child.on('error', (err) => {
    const msg = `MediaMTX process error: ${err.message}`;
    logger.error(msg);
    emitErr('mediamtx', msg);
  });

  child.stdout.on('data', d => emitLog('mediamtx', d.toString()));
  child.stderr.on('data', d => emitLog('mediamtx', d.toString()));

  child.on('exit', (code, signal) => {
    logger.warn(`MediaMTX exited (code=${code}, signal=${signal})`);
    mediamtxProcess = null;
    updateMediaState({ running: false, pid: null, startedAt: null });
    emitStatus();

    // If FFmpeg is running, stop it (publisher will be gone)
    if (ffmpegProcess) stopFFmpeg();

    // retry automatically
    backoff('mtx', startMediaMTX);
  });

  // Don’t crash if ports aren’t open—just retry later
  try {
    await waitForTcp('127.0.0.1', HTTP_PORT, 12000);
    await waitForTcp('127.0.0.1', RTSP_PORT, 12000);
    logger.info('MediaMTX is listening.');
    // reset backoff on success
    sched.mtx.attempt = 0;
  } catch (e) {
    const msg = `MediaMTX ports not listening yet: ${e.message}`;
    logger.warn(msg);
    emitErr('mediamtx', msg);
    // FFmpeg start will also wait on RTSP when needed
  }
}

function stopMediaMTX() {
  if (!RUN_LOCAL) return;
  clearTimer('mtx');
  if (!mediamtxProcess) return;
  logger.info('Stopping MediaMTX…');
  try { mediamtxProcess.kill('SIGTERM'); } catch {}
}

function killMediaMTXHard() {
  if (!RUN_LOCAL) return;
  if (!mediamtxProcess) return;
  try { mediamtxProcess.kill('SIGKILL'); } catch {}
}

// --- FFmpeg (fail-safe) ---
function buildSrtPublishTarget() {
  if (!SRT_CONFIG.enabled || SRT_CONFIG.error) {
    throw new Error(SRT_CONFIG.error || 'SRT publish target not configured');
  }
  const params = [
    `mode=${encodeURIComponent(SRT_CONFIG.mode || 'caller')}`,
    `latency=${Math.round(SRT_CONFIG.latencyMs)}`,
  ];
  if (SRT_CONFIG.streamId) {
    params.push(`streamid=${encodeURIComponent(SRT_CONFIG.streamId)}`);
  }
  if (SRT_CONFIG.passphrase) {
    params.push(`passphrase=${encodeURIComponent(SRT_CONFIG.passphrase)}`);
    if (SRT_CONFIG.pbKeyLen) {
      params.push(`pbkeylen=${encodeURIComponent(SRT_CONFIG.pbKeyLen)}`);
    }
  }
  return `srt://${SRT_CONFIG.host}:${SRT_CONFIG.port}?${params.join('&')}`;
}

function ffmpegArgsExact() {
  const args = [
    '-fflags', 'nobuffer', '-flags', 'low_delay', '-use_wallclock_as_timestamps', '1',
    '-thread_queue_size', '512',
    '-f', 'v4l2', '-input_format', 'h264', '-framerate', '30', '-video_size', '640x480', '-i', CAMERA_DEVICE_PATH,
    '-thread_queue_size', '512',
    '-f', 'alsa', '-ac', '1', '-ar', '48000', '-i', AUDIO_DEVICE_ALSA,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy',
  ];

  if (USE_SRT_PUBLISH) {
    args.push(
      '-c:a', 'aac',
      '-b:a', SRT_CONFIG.audioBitrate,
      '-ar', '48000',
      '-ac', '1',
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-max_interleave_delta', '0',
      '-flush_packets', '1',
      '-f', 'mpegts',
      buildSrtPublishTarget()
    );
  } else {
    args.push(
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      '-application', 'lowdelay',
      '-frame_duration', '20',
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-max_interleave_delta', '0',
      '-f', 'rtsp',
      '-rtsp_transport', 'tcp',
      `rtsp://127.0.0.1:${RTSP_PORT}/${encodeURIComponent(STREAM_NAME)}`
    );
  }

  return args;
}

async function startFFmpeg() {
  if (ffmpegProcess || state.ffmpeg.running) return;

  if (!RUN_LOCAL && !USE_SRT_PUBLISH) {
    const msg = SRT_CONFIG.error || 'External MediaMTX mode requires mediamtx.external.srt configuration';
    logger.error(msg);
    updateFfState({ lastError: msg });
    emitErr('ffmpeg', msg);
    emitStatus();
    return;
  }

  clearTimer('ff');
  updateFfState({ lastError: null });
  emitStatus();

  // Ensure MTX is (attempting to be) up when we run it locally
  if (RUN_LOCAL && !mediamtxProcess && !state.mediamtx.running) await startMediaMTX();

  // Wait a bit for RTSP; do not throw—just retry if not ready
  if (RUN_LOCAL) {
    try { await waitForTcp('127.0.0.1', RTSP_PORT, 10000); } catch {}
  }

  let child;
  try {
    const args = ffmpegArgsExact();
    const logArgs = USE_SRT_PUBLISH
      ? args.map(arg => (typeof arg === 'string' ? arg.replace(/passphrase=[^&\s]+/gi, 'passphrase=***') : arg))
      : args;
    logger.info(`Starting FFmpeg (${USE_SRT_PUBLISH ? 'SRT publish' : 'local RTSP'}): ${FFMPEG_BINARY_PATH} ${logArgs.join(' ')}`);
    child = spawn(FFMPEG_BINARY_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = e && e.code === 'ENOENT'
      ? `FFmpeg binary not found: ${FFMPEG_BINARY_PATH}`
      : `Failed to spawn FFmpeg: ${e.message}`;
    logger.error(msg);
    updateFfState({ lastError: msg });
    emitErr('ffmpeg', msg);
    emitStatus();
    backoff('ff', startFFmpeg);
    return;
  }

  ffmpegProcess = child;
  updateFfState({ running: true, pid: child.pid, startedAt: Date.now(), lastError: null });
  emitStatus();

  child.on('error', (err) => {
    const msg = `FFmpeg process error: ${err.message}`;
    logger.error(msg);
    emitErr('ffmpeg', msg);
  });

  child.stdout.on('data', d => emitLog('ffmpeg', d.toString()));
  child.stderr.on('data', d => {
    const line = d.toString();
    emitLog('ffmpeg', line);

    // Common device errors -> mark and schedule retry, but don't crash
    if (/\bNo such file or directory\b|\bInput\/output error\b|\bDevice or resource busy\b/i.test(line)) {
      updateFfState({ lastError: line.trim() });
      emitStatus();
    }
  });

  child.on('exit', (code, signal) => {
    logger.warn(`FFmpeg exited (code=${code}, signal=${signal})`);
    ffmpegProcess = null;
    updateFfState({ running: false, pid: null, startedAt: null });
    emitStatus();

    // If MTX is down, FFmpeg will be retried once MTX restarts anyway
    if (RUN_LOCAL || USE_SRT_PUBLISH) {
      backoff('ff', startFFmpeg);
    }
  });
}

function stopFFmpeg() {
  clearTimer('ff');
  if (!ffmpegProcess) return;
  logger.info('Stopping FFmpeg…');
  try { ffmpegProcess.kill('SIGTERM'); } catch {}
}

function killFFmpegHard() {
  if (!ffmpegProcess) return;
  try { ffmpegProcess.kill('SIGKILL'); } catch {}
}

// --- High-level control ---
async function startAV() {
  if (RUN_LOCAL) await startMediaMTX();
  await startFFmpeg();
}
function stopAV() {
  stopFFmpeg();
  if (RUN_LOCAL) setTimeout(stopMediaMTX, 400);
}

// --- Socket.IO wiring (defensive; never throws) ---
io.on('connection', (socket) => {
  socket.on('mediamtx:start', () => { startMediaMTX().catch(()=>{}); });
  socket.on('mediamtx:stop',  () => { stopMediaMTX(); });
  socket.on('mediamtx:restart', () => { stopMediaMTX(); setTimeout(()=> startMediaMTX().catch(()=>{}), 700); });
  socket.on('mediamtx:status', () => emitStatus());

  socket.on('ffmpeg:start', () => { startFFmpeg().catch(()=>{}); });
  socket.on('ffmpeg:stop',  () => { stopFFmpeg(); });
  socket.on('ffmpeg:restart', () => { stopFFmpeg(); setTimeout(()=> startFFmpeg().catch(()=>{}), 700); });
  socket.on('ffmpeg:status', () => emitStatus());

  socket.on('av:start', () => { startAV().catch(()=>{}); });
  socket.on('av:stop',  () => { stopAV(); });
  socket.on('av:restart', () => { stopAV(); setTimeout(()=> startAV().catch(()=>{}), 1000); });

  emitStatus();
});

// --- Process-level safety ---
function cleanup() {
  try { stopFFmpeg(); } catch {}
  try { stopMediaMTX(); } catch {}
  setTimeout(() => {
    try { killFFmpegHard(); } catch {}
    try { killMediaMTXHard(); } catch {}
  }, 2500);
}
function shutdown(code = 0) {
    // stop backoff timers so nothing restarts
    try { if (sched.ff.timer) clearTimeout(sched.ff.timer); } catch {}
    try { if (sched.mtx.timer) clearTimeout(sched.mtx.timer); } catch {}
  
    // stop processes gracefully
    try { stopFFmpeg(); } catch {}
    try { stopMediaMTX(); } catch {}
  
    // hard-kill after a grace period to avoid orphaned children
    setTimeout(() => {
      try { killFFmpegHard(); } catch {}
      try { killMediaMTXHard(); } catch {}
      // finally, exit this Node process
      process.exit(code);
    }, 2500);
  }
  
  // Use once() so multiple signals don’t stack cleanups
  process.once('SIGINT',  () => { logger.info('SIGINT received');  shutdown(0); });
  process.once('SIGTERM', () => { logger.info('SIGTERM received'); shutdown(0); });
  
  // (Optional) if you use nodemon, it sends SIGUSR2 for restarts:
  process.once('SIGUSR2', () => { logger.info('SIGUSR2'); shutdown(0); });
  
  // Keep these to avoid crashes during dev; they do NOT exit.
  process.on('uncaughtException', (err) => {
    logger.error(`uncaughtException: ${err.stack || err.message}`);
    emitErr('manager', `uncaughtException: ${err.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`unhandledRejection: ${reason && reason.stack || reason}`);
    emitErr('manager', `unhandledRejection: ${reason}`);
  });
  
writeExternalConfigIfNeeded();

// Optional autostart
(async () => {
  if (AUTO_START) {
    logger.info('Auto-start enabled: starting AV pipeline…');
    try { await startAV(); } catch (e) { logger.error(`Auto-start failed: ${e.message}`); }
  }
})();

module.exports = {
  startMediaMTX, stopMediaMTX,
  startFFmpeg,   stopFFmpeg,
  startAV,       stopAV,
  status: () => ({ mediamtx: state.mediamtx, ffmpeg: state.ffmpeg })
};
