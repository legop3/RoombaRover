const {driveDirect, playRoombaSong, RoombaController} = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const chatPrompt = fs.readFileSync('./prompts/chat.txt', 'utf8').trim();
let systemPrompt = fs.readFileSync('./prompts/system.txt', 'utf8').trim();
const roombaStatus = require('./roombaStatus');
const { Ollama } = require('ollama');
const Jimp = require('jimp');

// Create a client instance with the external server URL
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });
const controller = new RoombaController(port);

// --- Basic local world model -------------------------------------------------
// The rover keeps a very small in-memory occupancy grid to provide the LLM
// with spatial context.  No heavy processing is done here; we simply integrate
// executed movement commands and bump sensor hits.
const CELL_SIZE = 200; // mm per grid cell
const CAMERA_HEIGHT_MM = 80; // approximate height of camera from floor
const WORLD_FILE = 'world-state.json';
let pose = { x: 0, y: 0, theta: 0 }; // mm, mm, degrees
let worldMap = {}; // key: "x,y" => { visited: bool, obstacle: bool }

loadWorld();
markVisited();

function markVisited() {
  const cellX = Math.round(pose.x / CELL_SIZE);
  const cellY = Math.round(pose.y / CELL_SIZE);
  const key = `${cellX},${cellY}`;
  if (!worldMap[key]) worldMap[key] = { visited: true, obstacle: false };
  else worldMap[key].visited = true;
  saveWorld();
}

function updateMapWithBumps() {
  if (roombaStatus.bumpSensors.bumpLeft === 'ON' || roombaStatus.bumpSensors.bumpRight === 'ON') {
    const rad = (pose.theta * Math.PI) / 180;
    const ox = pose.x + Math.cos(rad) * CELL_SIZE;
    const oy = pose.y + Math.sin(rad) * CELL_SIZE;
    const cellX = Math.round(ox / CELL_SIZE);
    const cellY = Math.round(oy / CELL_SIZE);
    const key = `${cellX},${cellY}`;
    if (!worldMap[key]) worldMap[key] = { visited: false, obstacle: true };
    else worldMap[key].obstacle = true;
    saveWorld();
  }
}

function loadWorld() {
  try {
    const data = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    if (data.pose) pose = data.pose;
    if (data.worldMap) worldMap = data.worldMap;
    console.log('Loaded world model');
  } catch (_) {
    // no existing map
  }
}

function saveWorld() {
  try {
    fs.writeFileSync(WORLD_FILE, JSON.stringify({ pose, worldMap }));
  } catch (err) {
    console.error('Failed to save world model:', err.message);
  }
}

function getMapExcerpt(radius = 2) {
  const originX = Math.round(pose.x / CELL_SIZE);
  const originY = Math.round(pose.y / CELL_SIZE);
  const excerpt = [];
  const rad = (pose.theta * Math.PI) / 180;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const worldKey = `${originX + dx},${originY + dy}`;
      const cell = worldMap[worldKey] || { visited: false, obstacle: false };
      const worldOffsetX = dx * CELL_SIZE;
      const worldOffsetY = dy * CELL_SIZE;
      const forward = worldOffsetX * Math.cos(rad) + worldOffsetY * Math.sin(rad);
      const right = worldOffsetX * Math.sin(rad) - worldOffsetY * Math.cos(rad);
      excerpt.push({
        forward_mm: Math.round(forward),
        right_mm: Math.round(right),
        visited: !!cell.visited,
        obstacle: !!cell.obstacle
      });
    }
  }
  return excerpt;
}

// Downscale the camera image before sending to the LLM so the main
// streaming feed can remain full resolution.
async function downscaleImage(base64, width = 160, height = 120) {
  try {
    const img = await Jimp.read(Buffer.from(base64, 'base64'));
    img.resize(width, height).quality(60);
    return await img.getBase64Async(Jimp.MIME_JPEG);
  } catch (err) {
    console.error('Image downscale failed:', err.message);
    return base64;
  }
}

async function getVisionSummary(cameraImageBase64) {
  if (!cameraImageBase64) return [];
  let resized = cameraImageBase64;
  try {
    resized = await downscaleImage(cameraImageBase64);
  } catch (err) {
    console.error('Failed to downscale vision image:', err.message);
  }
  if (!config.ollama.modelName) return [];
  try {
    const vision = await ollama.chat({
      model: config.ollama.modelName,
      messages: [
        {
          role: 'system',
          content:
            'You are a detector. Return JSON array [{"label":string,"bearing_deg":deg,"distance_mm":mm?}]. Bearing is relative to the robot: 0 is straight ahead, positive is left, negative is right. Return only JSON.'
        },
        { role: 'user', content: 'Describe objects in view.' }
      ],
      images: [resized]
    });
    const text = vision.message?.content?.trim();
    if (!text) return [];
    return JSON.parse(text);
  } catch (err) {
    console.error('Vision summary error:', err.message);
    return [];
  }
}

function constructStatePacket(detections) {
  return {
    pose: {
      x: Math.round(pose.x),
      y: Math.round(pose.y),
      theta: Math.round(pose.theta)
    },
    map: getMapExcerpt(),
    detections,
    last_command: lastCommand,
    last_move: lastMove,
    bump_left: roombaStatus.bumpSensors.bumpLeft,
    bump_right: roombaStatus.bumpSensors.bumpRight,
    current_goal: currentGoal,
    camera_height_mm: CAMERA_HEIGHT_MM
  };
}
let lastMove = null;

controller.on('roomba:done', ({ distanceMm, turnDeg }) => {
  // Update orientation then position
  pose.theta = (pose.theta + turnDeg) % 360;
  if (pose.theta < 0) pose.theta += 360;
  const rad = (pose.theta * Math.PI) / 180;
  pose.x += distanceMm * Math.cos(rad);
  pose.y += distanceMm * Math.sin(rad);
  lastMove = {
    distance_mm: Math.round(distanceMm),
    turn_deg: Math.round(turnDeg)
  };
  markVisited();
});
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;

let loopRunning = false;

async function setGoal(goal) {
  currentGoal = goal;
  AIControlLoop.emit('goalSet', goal);
}

defaultParams = {
  temperature: config.ollama.parameters.temperature || 0.7,
  top_k: config.ollama.parameters.top_k || 40,
  top_p: config.ollama.parameters.top_p || 0.9,
  min_k: config.ollama.parameters.min_k || 1,
  num_predict: config.ollama.parameters.num_predict || 128
}

let movingParams = defaultParams;


// Streaming function with real-time command parsing
async function streamChatFromCameraImage(cameraImageBase64) {
  updateMapWithBumps();

  Object.entries(roombaStatus.lightBumps).forEach((value, key) => {
    console.log(`Light bump sensor ${key}: ${value[1]}`);

    // Placeholder for future light bump to bump emulation logic
  });

  const detections = await getVisionSummary(cameraImageBase64);
  const statePacket = constructStatePacket(detections);

  console.log('State packet:\n', JSON.stringify(statePacket));

  try {
    console.log('Starting streaming chat with Ollama...');
    // Prepare the user message with the state packet as JSON
    const userMessage = {
      role: 'user',
      content: JSON.stringify(statePacket),
    };

    const response = await ollama.chat({
      model: config.ollama.modelName,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        userMessage,
      ],
      stream: true,
      keep_alive: -1,
      options: {
        temperature: movingParams.temperature,
        top_k: movingParams.top_k,
        top_p: movingParams.top_p,
        min_k: movingParams.min_k,
        num_predict: movingParams.num_predict
      }
    });
    
    let fullResponse = '';
    let commandBuffer = '';
    let chunkCount = 0;
    
    console.log('Starting to process streaming response...');
    
    // Process the streaming response
    for await (const part of response) {
      try {
        if (part.message?.content) {
          chunkCount++;
          const chunk = part.message.content;
          fullResponse += chunk;
          commandBuffer += chunk;
          
          // Emit the streaming chunk
          AIControlLoop.emit('streamChunk', chunk);
          
          // Check for complete commands in the buffer
          const commands = parseCommandsFromBuffer(commandBuffer);
          
          // Execute any complete commands found
          if (commands.length > 0) {
            commands.forEach(cmd => {
              console.log(`Executing real-time command: ${cmd.action} ${cmd.value}`);
              runCommands([cmd]);
              AIControlLoop.emit('commandExecuted', cmd);
            });
            
            // Remove executed commands from buffer
            commandBuffer = removeExecutedCommands(commandBuffer, commands);
          }
        }
      } catch (chunkError) {
        console.error('Error processing chunk:', chunkError);
      }
    }
    
    console.log(`Streaming completed. Processed ${chunkCount} chunks.`);
    
    // Process any remaining commands in the buffer
    const finalCommands = parseCommandsFromBuffer(commandBuffer);
    if (finalCommands.length > 0) {
      console.log('Executing final commands from buffer...');
      runCommands(finalCommands);
      finalCommands.forEach(cmd => {
        AIControlLoop.emit('commandExecuted', cmd);
      });
    }
    
    console.log('Full Ollama response:', fullResponse);
    AIControlLoop.emit('responseComplete', fullResponse);
    lastResponse = fullResponse;
    
    return fullResponse;
  } catch (error) {
    console.error('Error in streaming chat:', error);
    AIControlLoop.emit('streamError', error);
    throw error;
  }
}

// Command parsing for streaming content
function parseCommandsFromBuffer(buffer) {
  const commands = [];
  const commandRegex = /\[(forward|backward|left|right|strafeLeft|strafeRight|say|new_goal) ([^\]]+)\]/g;
  let match;
  
  while ((match = commandRegex.exec(buffer)) !== null) {
    const action = match[1];
    const value = match[2];
    commands.push({ action, value, fullMatch: match[0] });
  }
  
  return commands;
}

// Remove executed commands from buffer to prevent re-execution
function removeExecutedCommands(buffer, executedCommands) {
  let cleanBuffer = buffer;
  executedCommands.forEach(cmd => {
    cleanBuffer = cleanBuffer.replace(cmd.fullMatch, '');
  });
  return cleanBuffer;
}

// Speech queue management
const speechQueue = [];
let isSpeaking = false;

function speak(text) {
  speechQueue.push(text);
  processQueue();
}

function processQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  isSpeaking = true;
  const text = speechQueue.shift();
  const espeak = spawn('flite', ['-voice', 'rms', '-t', `"${text}"`]);
  
  espeak.on('error', (err) => {
    console.error(`eSpeak error: ${err.message}`);
    isSpeaking = false;
    processQueue();
  });
  
  espeak.on('exit', () => {
    isSpeaking = false;
    processQueue();
  });
}

// Command execution
function runCommands(commands) {
  commands.forEach(command => {
    command.action = command.action.toLowerCase();
    if(!loopRunning) { console.log('loop not running, skipping command'); return }
    lastCommand = command; // Store the last command for context
    console.log('new last command: ', lastCommand)
    switch (command.action) {
      case 'forward':
        const forwardMeters = parseFloat(command.value);
        if (!isNaN(forwardMeters)) {
          console.log(`Moving forward ${forwardMeters}mm`);
          controller.move(forwardMeters, 0);
        } else {
          console.error(`Invalid forward command value: ${command.value}`);
        }
        break;
      case 'backward':
        const backwardMeters = parseFloat(command.value);
        if (!isNaN(backwardMeters)) {
          console.log(`Moving backward ${backwardMeters}mm`);
          controller.move(-backwardMeters, 0);
        } else {
          console.error(`Invalid backward command value: ${command.value}`);
        }
        break;
      case 'left':
        const leftAngle = parseFloat(command.value);
        if (!isNaN(leftAngle)) {
          console.log(`Turning left ${leftAngle} degrees`);
          controller.move(0, leftAngle);
        } else {
          console.error(`Invalid left command value: ${command.value}`);
        }
        break;
      case 'right':
        const rightAngle = parseFloat(command.value);
        if (!isNaN(rightAngle)) {
          console.log(`Turning right ${rightAngle} degrees`);
          controller.move(0, -rightAngle);
        } else {
          console.error(`Invalid right command value: ${command.value}`);
        }
        break;
      case 'say':
        const sentence = command.value;
        if (sentence && sentence.length > 0) {
          console.log(`Saying: ${sentence}`);
          speak(sentence);
        } else {
          console.error(`Invalid say command value: ${command.value}`);
        }
        break;
      case 'new_goal':
        console.log(`goal command run: ${command.value}`);
        const goalText = command.value;
        if (goalText && goalText.length > 0 && goalText !== currentGoal) {
          console.log(`Setting goal: ${goalText}`);
          currentGoal = goalText;
          AIControlLoop.emit('goalSet', goalText);
        } else if (goalText === currentGoal) {
          console.log('Goal unchanged; ignoring.');
        } else {
          console.error(`Invalid goal command value: ${command.value}`);
        }
        break;
      default:
        console.error(`Unknown command action: ${command.action}`);
    }
  });
}

// Simplified AI Control Loop Class - streaming only
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
    console.log('loopRunning', loopRunning);
    console.log('Robot control loop started in streaming mode.');

    
    tryWrite(port, [131]); // tell roomba to enter safe mode
    iterationCount = 0;
    
    while (this.isRunning) {
      try {
        iterationCount++;
        console.log(`\n=== Control Loop Iteration ${iterationCount} ===`);
        this.emit('controlLoopIteration', { iterationCount, status: 'started' });
        
        // Get camera image with error handling
        let cameraImage;
        try {
          cameraImage = getLatestFrontFrame();
          console.log(`Camera image obtained: ${cameraImage ? 'Yes' : 'No'}`);
        } catch (cameraError) {
          console.error('Error getting camera image:', cameraError);
          cameraImage = null;
        }
        
        try {
          await streamChatFromCameraImage(cameraImage);
          console.log('Streaming completed successfully');
        } catch (streamError) {
          console.error('Streaming error:', streamError);
          this.emit('streamError', streamError);
        }
        
        // Wait for roomba queue to empty before next iteration
        console.log('Waiting for roomba queue to empty...');
        try {
          await Promise.race([
            new Promise((resolve) => controller.once('roomba:queue-empty', resolve)),
            new Promise((resolve) => setTimeout(resolve, 5000)) // 5 second timeout
          ]);
          console.log('Roomba queue empty or timeout reached');
        } catch (queueError) {
          console.error('Error waiting for roomba queue:', queueError);
        }
        
        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 50));
        
        console.log(`=== End of Iteration ${iterationCount} ===\n`);
        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
        
      } catch (err) {
        console.error(`Error in control loop iteration ${iterationCount}:`, err);
        this.emit('controlLoopError', err);
        
        // Add a delay before retrying to prevent rapid error loops
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('Continuing after error...');
      }
    }
    
    console.log('Robot control loop stopped.');
  }

  stop() {
    if (!this.isRunning) {
      // console.log('Robot control loop is not running.');
      return;
    }
    this.isRunning = false;
    this.emit('aiModeStatus', false);
    loopRunning = false;
    console.log('loopRunning', loopRunning)
    lastResponse = '';
  }
}

const AIControlLoop = new AIControlLoopClass();

function setParams(params) {
  // console.log('Setting Ollama parameters:', params);

  if (params.temperature !== undefined) {
    movingParams.temperature = params.temperature;
    console.log(`Temperature set to ${movingParams.temperature}`);
  }

  if (params.top_k !== undefined) {
    movingParams.top_k = params.top_k;
    console.log(`Top K set to ${movingParams.top_k}`);
  }

  if (params.top_p !== undefined) {
    movingParams.top_p = params.top_p;
    console.log(`Top P set to ${movingParams.top_p}`);
  }

  if (params.min_k !== undefined) {
    movingParams.min_k = params.min_k;
    console.log(`Min K set to ${movingParams.min_k}`);
  }

  if (params.num_predict !== undefined) {
    movingParams.num_predict = params.num_predict;
    console.log(`Num predict set to ${movingParams.num_predict}`);
  }
  // console.log('new ollama params:', movingParams);
}

function getParams() {
  return {
    temperature: movingParams.temperature,
    top_k: movingParams.top_k,
    top_p: movingParams.top_p,
    min_k: movingParams.min_k,
    num_predict: movingParams.num_predict
  };
}



// Export the simplified functions
module.exports = {
  streamChatFromCameraImage,
  AIControlLoop,
  speak,
  runCommands,
  getCurrentGoal: () => currentGoal,
  setGoal,
  clearGoal: () => {
    currentGoal = null;
    AIControlLoop.emit('goalCleared');
  },
  setParams,
  getParams,
  getPose: () => ({ ...pose }),
  getMapExcerpt,
};
