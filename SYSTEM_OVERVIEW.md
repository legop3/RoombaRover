# Roomba Rover System Overview

> **Maintainers & LLMs:** When you change behaviour, APIs, or configuration, update this document in the same change. Treat it as the canonical map of the project.

## 1. Big Picture
- **Purpose:** Provide a remote driving experience for a Roomba-based rover with live video, audio, chat, Discord integration, and optional AI autopilot via Ollama.
- **Stack:** Node.js server (`server.js`) with Socket.IO + Express, static frontend under `public/`, serial control via `serialport`, Discord bot (`discord.js`), camera/audio via system binaries (`ffmpeg`, `arecord`, `flite`, `usbreset`).
- **Core Loop:** Clients connect → `accessControl` decides drive rights → Socket events drive motors through `roombaCommands` → sensor packets arrive through `serialPort` and feed `batteryManager` + UI → optional AI mode runs `ollama` control loop.
- **Shared State:** `roombaStatus.js` holds the latest rover telemetry; `ioContext.js` stores the singleton Socket.IO instance for cross-module emits.

## 2. Runtime Flow Highlights
- **Startup:** `server.js` loads config (`config.js` ↔ `config.yaml`), sets Socket.IO middlewares, boots the Discord bot (`discordBot.js`) if enabled, initialises camera/audio helpers, battery manager, and turn handler.
- **Client Connection:** `accessControl.js` authenticates (per-admin passwords) and enforces mode-specific driving rights (`admin`, `turns`, `open`). `server.js` seeds nicknames, shares UI config, and starts telemetry streaming on demand.
- **Driving Commands:** `Speedchange` socket event calls `driveDirect` to stream wheel speeds over Serial. Auxiliary brush/vacuum motors are handled through `auxMotorSpeeds` events.
- **Sensor Pipeline:** `serialPort.js` listens for 44‑byte packets; `server.js` parses them, updates `roombaStatus`, and delegates battery logic to `batteryManager.js`, which can auto-alert Socket.IO + Discord admins, pause the turn queue, and trigger Roomba docking commands.
- **Turns Queue:** `turnHandler.js` keeps a rotating queue of non-admin drivers when `turns` mode is active, pausing/resuming based on battery charging state and broadcasting queue status to the frontend.
- **AI Mode:** `ollama.js` streams camera frames into an Ollama vision+LLM model, parses commands like `[forward 200]`, and feeds `RoombaController` move queue. Events mirror status back to clients (`ollamaStreamChunk`, `newGoal`, etc.).
- **Discord Presence:** `discordBot.js` exposes text commands (`open`, `turns`, `admin`), raises alerts (battery low, idle undocked rover, charging complete) while pinging the configured admin role, and maintains presence text with mode + battery info. Mode + charging announcements tag watcher roles.
- **Media Streams:** Front camera uses FFmpeg piping MJPEG frames (`CameraStream.js`). Audio streaming uses `arecord`; speech synthesis via `flite` (`ollama.speak`).

## 3. Configuration Surfaces (`config.yaml`)
- **serial.port / baudrate:** Device path and speed for Roomba Open Interface.
- **express.port:** Web server port.
- **camera / rearCamera:** Linux video devices + USB IDs; rear cam toggled via `enabled`.
- **audio.device:** ALSA capture source passed to `arecord`.
- **battery:** Voltage thresholds + filter tuning for `batteryManager` (mV values). Includes autocharge options inside `battery.autoCharge`.
- **roverDisplay.enabled:** Launches kiosk browser for `/viewer` on boot via `epiphany`.
- **accessControl.admins (name/password/discordId):** Credentials used by the web UI and Discord bot.
- **discordBot:** Bot toggle, token, alert+announcement channels, role IDs for admins/watchers, hosting URL/invite.
- **ollama:** External Ollama host/port, model, loop delay, and default generation parameters.
- **logging.level:** Optional default verbosity for the shared logger (`debug`, `info`, `warn`, `error`). Can also be overridden with the `LOG_LEVEL` env var.

Reloading config requires restarting the Node process; hot reload is not implemented.

## 4. Key Modules
- `server.js`: Main orchestrator. Manages Socket.IO events, serial parsing, camera/audio lifecycle, AI hooks, and Express static hosting. Also relays AI loop events back to clients and handles log capture streaming.
- `accessControl.js`: Socket.IO middleware enforcing access modes. Maintains `activeClientSessions` map to prevent multiple tabs per user and exposes `changeMode` + `state` used across modules.
- `adminDirectory.js`: Normalises admin definitions from config (supports per-admin credentials or legacy shared password) and exposes lookups for web auth + Discord mentions.
- `serialPort.js`: Opens the configured serial port and exports `port` instance plus a safe `tryWrite` helper.
- `roombaCommands.js`: Low-level command helpers (`driveDirect`, `playRoombaSong`, `auxMotorSpeeds`) and an event-driven `RoombaController` queue for AI motion primitives.
- `batteryManager.js`: Handles voltage filtering, alert throttling, Discord notifications, auto-docking, tone alarms, and coordination with `turnHandler` for charging pauses. Emits charge overlay payloads to the UI.
- `turnHandler.js`: Maintains queue state for `turns` mode, ensures only one non-admin drives, pauses on charge, and emits `turns:update` snapshots; interacts with `driveDirect` to halt motors during handoff.
- `ollama.js`: Wraps Ollama streaming chat API, builds prompts from camera frames + `prompts/system.txt` & `chat.txt`, parses inline command syntax, manages AI control loop lifecycle, speech queue, and parameter updates.
- `discordBot.js`: Discord client setup, admin command parsing, presence updates, idle monitoring (alerts when rover undocked + idle), and broadcast helpers (`alertAdmins`, `announceModeChange`, `announceDoneCharging`).
- `CameraStream.js`: Spawns FFmpeg, slices MJPEG frames, emits raw buffers over Socket.IO, and exposes latest front frame for AI snapshots.
- `logCapture.js`: Monkey-patches `process.stdout.write` to buffer recent logs and broadcast them over Socket.IO (used by web log viewer).
- `logger.js`: Central logging helper providing scoped loggers, level filtering, and consistent formatting across modules.
- `ioContext.js`: Simple singleton setter/getter for the Socket.IO server instance so modules can emit without circular requires.
- `roombaStatus.js`: Shared mutable telemetry snapshot consumed by Discord presence, UI, and AI prompts (battery %, docked state, bump/overcurrent details).

### Frontend (`public/`)
- `index.html` + `main.js`: Primary operator UI. Handles auth prompt, joystick inputs (via `nipplejs`), chat, sensor dashboard, turn queue display, charge warnings, and AI controls. Stores a `clientKey` in localStorage for session enforcement.
- `viewer/`: Read-only status display stream for on-board monitor, receiving `videoFrame:frontCamera` frames and chat feed.
- `admin/`: Lightweight admin dashboard shell (currently minimal JS).
- Supporting assets: Tailwind CSS build, joystick libs, `rover-help` overlay, audio player (`pcm-player.js`), etc.

### Prompts & Tests
- `prompts/`: Text snippets used by the Ollama control loop; `chat.txt` is appended to each user request, `system.txt` seeds the model persona (variants kept for experimentation).
- `tests/`: Hardware smoke scripts (e.g., `booper-test.js` for Roomba songs, `audio/`, `webcam/`). They are not wired into `npm test` and require manual execution on hardware.

## 5. Event Contracts
- **Socket.IO inbound (client → server):** `Speedchange`, `Docking`, `requestSensorData`, `startVideo`/`stopVideo`, aux motor toggles, `startAudio`/`stopAudio`, chat events (`userMessage`, `userTyping`), AI control toggles (`enableAIMode`, `setGoal`, `ollamaParamsPush`), `setNickname`, and admin utilities (`change-access-mode`, `rebootServer`).
- **Socket.IO outbound (server → client):** `SensorData`, `turns:update`, `userlist`, `usercount`, `nickname:update`, `alert`, `message`, `audio`, `videoFrame:*`, AI status (`ollamaStreamChunk`, `aiModeEnabled`, `newGoal`, `controlLoopIteration`), `charge-warning` payloads, `logs`, and various warnings.
- **Discord commands:** Plain text `open`, `turns`, `admin` (with optional `rp` alias). Alerts target channels via IDs configured in `config.yaml`.
- **Serial commands:** Battery polling uses `tryWrite` with Roomba Open Interface opcode 149 sequence (sensor group). Docking uses opcode 143; safe mode / drive opcodes 131/145.

## 6. Operational Notes
- **Dependencies:** Ensure `ffmpeg`, `arecord` (ALSA), `flite`, `usbreset`, and `sudo` permissions exist on the host. Discord bot and Ollama require network reachability (check sandbox/policy if running in restricted environments).
- **AI Safety:** `ollama.js` blocks motion commands when the loop is stopped. Any new motion op should respect `loopRunning` guard and consider Roomba safety (e.g., enforce safe velocities, check bump sensors before moving).
- **Turns vs. Open Mode:** `accessControl.changeMode` broadcast resets non-admin sockets. If you add new modes or auth flows, update `COMMANDS` in `discordBot.js`, UI toggles, and this document.
- **Battery Alerts:** `batteryManager` contains tuned constants (millivolt thresholds, debounce, `recoveredChargeUnits` for the raw sensor value that counts as “charged”). Adjust thoughtfully and keep `config.yaml` and documentation in sync. Discord announcements call `announceDoneCharging()` when fully charged.
- **Logging:** Application code logs via `logger.js` (scoped levels, no timestamps). Adjust verbosity with `config.logging.level` or the `LOG_LEVEL` env var.
- **Log Capture:** The last ~50 stdout lines are buffered. If you add high-volume logging, consider throttling or expanding buffer capacity.
- **Services:** Example systemd unit files live at `roomba-rover.service.example` and `roomba-rover-display.service.example` for deploying both the server and the kiosk display.

## 7. Extending & Maintaining
1. **Before coding:** Check this document to understand affected subsystems.
2. **While coding:** Keep module cross-dependencies minimal; prefer emitting events rather than importing Socket.IO directly—use `ioContext`.
3. **After changes:** Update `SYSTEM_OVERVIEW.md` with:
   - New/removed modules or events.
   - Behaviour changes (e.g., altered turn timing, new Discord commands).
   - Config knobs or defaults that moved.
4. **Testing:** There is no automated test suite. Validate on hardware when touching serial, camera, or audio code. Document ad-hoc test steps in commit messages or add scripts under `tests/`.
5. **LLM Collaboration:** If using an LLM to modify the project, ensure the assistant both reads and amends this doc. Include the relevant excerpt in the conversation prompt to avoid regressions.

## 8. Quick Reference Table

| Area | Entry Points | Notes |
| --- | --- | --- |
| Web Server | `server.js`, Express static hosting | Primary Socket.IO hub, handles sensors, AI loop events. |
| Auth & Modes | `accessControl.js`, `adminDirectory.js`, `discordBot.js` | Enforces admin passwords, Discord commands, single-session clients. |
| Hardware I/O | `serialPort.js`, `roombaCommands.js`, `batteryManager.js` | Serial comms, auto-docking, low-battery alarms. |
| Media | `CameraStream.js`, audio helpers in `server.js` | FFmpeg MJPEG + ALSA audio, optional viewer kiosk. |
| AI Control | `ollama.js`, `prompts/` | Streams camera frames into Ollama, parses `[command value]` syntax, manages speech. |
| Frontend | `public/` assets | Operator UI, viewer display, admin shell. |
| Monitoring | `logger.js`, `logCapture.js`, Discord alerts | Scoped logging helper, Socket log viewer, Discord notifications for battery/idle status. |
| Turns Queue | `turnHandler.js` | Maintains fair access for non-admin drivers, pauses on charge. |

---
_Last updated: 2025-05-12. Replace this line with the current date when you edit._
