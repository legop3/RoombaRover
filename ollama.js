const {driveDirect, playRoombaSong, RoombaController} = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const chatPrompt = fs.readFileSync('./prompts/chat.txt', 'utf8').trim();
const systemPrompt = fs.readFileSync('./prompts/system.txt', 'utf8').trim();
const { BehaviorManager } = require('./autonomy/behaviors/BehaviorManager');
const { MissionPlanner } = require('./autonomy/planner/MissionPlanner');
const { WorldModel } = require('./autonomy/perception/WorldModel');
const { Ollama } = require('ollama');

// Create a client instance with the external server URL
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });
const controller = new RoombaController(port);
const worldModel = new WorldModel();
const behaviorManager = new BehaviorManager(controller, worldModel);
const missionPlanner = new MissionPlanner(behaviorManager, worldModel);
let iterationCount = 0;
let lastResponse = '';
let currentGoal = null;
let lastCommand = null;

let loopRunning = false;

async function setGoal(goal, options = {}) {
  currentGoal = goal;
  missionPlanner.ingestLLMGoal(goal, { ...options, source: options.source || 'operator' });
  AIControlLoop.emit('goalSet', goal);
}

defaultParams = {
  temperature: config.ollama.parameters.temperature || 0.7,
  top_k: config.ollama.parameters.top_k || 40,
  top_p: config.ollama.parameters.top_p || 0.9,
  min_k: config.ollama.parameters.min_k || 1
}

let movingParams = defaultParams;


// Streaming function with real-time command parsing
async function streamChatFromCameraImage(cameraImageBase64) {
  const behaviorSummary = behaviorManager.describeStatus();
  const missionSummary = missionPlanner.describeStatus();
  const worldSummary = worldModel.describeForLLM();
  const goalText = currentGoal || 'No active mission. Suggest one using the [new_goal] command.';
  const commandGuide = 'Preferred commands: [new_goal text], [mission directive], [set_behavior behavior params], [say words]. Manual [forward]/[left]/[right]/[backward] are emergency nudges only.';
  const promptSections = [
    `last_command: ${lastCommand ? `${lastCommand.action} ${lastCommand.value}` : 'none'}`,
    `mission_summary: ${missionSummary}`,
    `behavior_summary: ${behaviorSummary}`,
    `world_state: ${worldSummary}`,
    `current_goal: ${goalText}`,
    commandGuide,
  ];
  if (chatPrompt) {
    promptSections.push(chatPrompt);
  }
  const constructChatPrompt = promptSections.join('\n');

  console.log('Constructed chat prompt:\n', constructChatPrompt);
  
  try {
    console.log('Starting streaming chat with Ollama...');
    console.log('Camera image base64 length:', cameraImageBase64 ? cameraImageBase64.length : 'No image provided');
    
    // Prepare the user message
    const userMessage = {
      role: 'user',
      content: constructChatPrompt,
    };
    
    // Only add images array if we have a valid image
    if (cameraImageBase64 && cameraImageBase64.length > 0) {
      const cleanBase64 = cameraImageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      userMessage.images = [cleanBase64];
      console.log('Added image to message, clean base64 length:', cleanBase64.length);
    }
    
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
        min_k: movingParams.min_k
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
  const commandRegex = /\[(forward|backward|left|right|strafeLeft|strafeRight|say|new_goal|set_behavior|mission|planner|manual_move)\s+([^\]]+)\]/gi;
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
  commands.forEach((command) => {
    const action = command.action.toLowerCase();
    if (!loopRunning) {
      console.log('loop not running, skipping command');
      return;
    }

    lastCommand = { action, value: command.value };
    console.log('new last command: ', lastCommand);

    switch (action) {
      case 'forward':
      case 'backward':
      case 'left':
      case 'right':
        behaviorManager.enqueueManualMotion(action, command.value);
        break;
      case 'say': {
        const sentence = command.value;
        if (sentence && sentence.length > 0) {
          console.log(`Saying: ${sentence}`);
          speak(sentence);
        } else {
          console.error(`Invalid say command value: ${command.value}`);
        }
        break;
      }
      case 'new_goal': {
        const goalText = command.value?.trim();
        if (goalText) {
          console.log(`Setting goal from LLM: ${goalText}`);
          setGoal(goalText, { source: 'llm' });
        } else {
          console.error(`Invalid goal command value: ${command.value}`);
        }
        break;
      }
      case 'set_behavior': {
        const directive = parseBehaviorDirective(command.value);
        if (directive.behavior) {
          behaviorManager.setBehavior(directive.behavior, directive.params, {
            source: 'llm',
            reason: 'llm-set_behavior',
          });
        } else {
          console.error(`Invalid behavior directive: ${command.value}`);
        }
        break;
      }
      case 'mission':
      case 'planner':
        console.log(`Applying mission directive: ${command.value}`);
        missionPlanner.ingestDirective(command.value, { source: 'llm' });
        break;
      case 'manual_move': {
        const manual = parseManualDirective(command.value);
        if (manual) {
          behaviorManager.enqueueManualMotion(manual.action, manual.value);
        } else {
          console.error(`Invalid manual_move directive: ${command.value}`);
        }
        break;
      }
      default:
        console.error(`Unknown command action: ${action}`);
    }
  });
}

function parseBehaviorDirective(rawValue = '') {
  const tokens = rawValue.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { behavior: null, params: {} };
  }
  const behavior = tokens.shift().toLowerCase();
  const params = {};

  tokens.forEach((token) => {
    const [key, raw] = token.split('=');
    if (raw !== undefined) {
      const numeric = Number.parseFloat(raw);
      params[key] = Number.isNaN(numeric) ? raw : numeric;
      return;
    }

    const lower = token.toLowerCase();
    if (!params.side && (lower === 'left' || lower === 'right')) {
      params.side = lower;
    } else if (!params.mode) {
      params.mode = lower;
    }
  });

  return { behavior, params };
}

function parseManualDirective(rawValue = '') {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const equalsSplit = trimmed.split('=');
  if (equalsSplit.length === 2) {
    const action = equalsSplit[0].trim().toLowerCase();
    const value = equalsSplit[1].trim();
    if (['forward', 'backward', 'left', 'right'].includes(action)) {
      return { action, value };
    }
  }

  const match = trimmed.match(/(forward|backward|left|right)\s+(-?[\d.]+)/i);
  if (match) {
    return { action: match[1].toLowerCase(), value: match[2] };
  }

  return null;
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
    behaviorManager.enableAutonomy('ai-start');
    missionPlanner.start();
    missionPlanner.tick();

    const waitForCycle = () =>
      Promise.race([
        new Promise((resolve) => behaviorManager.once('cycle-complete', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);

    try {
      while (this.isRunning) {
        try {
          iterationCount++;
          console.log(`\n=== Control Loop Iteration ${iterationCount} ===`);
          this.emit('controlLoopIteration', { iterationCount, status: 'started' });

          missionPlanner.tick();

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

          missionPlanner.tick();

          try {
            await waitForCycle();
          } catch (cycleError) {
            console.error('Error waiting for behavior cycle:', cycleError);
          }

          // Small delay to prevent overwhelming the system
          await new Promise((resolve) => setTimeout(resolve, 100));

          console.log(`=== End of Iteration ${iterationCount} ===\n`);
          this.emit('controlLoopIteration', { iterationCount, status: 'completed' });
        } catch (err) {
          console.error(`Error in control loop iteration ${iterationCount}:`, err);
          this.emit('controlLoopError', err);

          // Add a delay before retrying to prevent rapid error loops
          await new Promise((resolve) => setTimeout(resolve, 2000));
          console.log('Continuing after error...');
        }
      }
    } finally {
      if (loopRunning) {
        this.emit('aiModeStatus', false);
      }
      loopRunning = false;
      this.isRunning = false;
      missionPlanner.stop();
      behaviorManager.disableAutonomy('ai-loop-exit');
      console.log('Robot control loop stopped.');
    }
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
    missionPlanner.stop();
    behaviorManager.disableAutonomy('ai-stop');
  }
}

const AIControlLoop = new AIControlLoopClass();

behaviorManager.on('state', (state) => AIControlLoop.emit('behaviorState', state));
behaviorManager.on('reflex', (event) => AIControlLoop.emit('behaviorReflex', event));
behaviorManager.on('manual-override', (event) => AIControlLoop.emit('behaviorManualOverride', event));
missionPlanner.on('mission-updated', (status) => AIControlLoop.emit('missionUpdate', status));
worldModel.on('summary', (payload) => AIControlLoop.emit('worldSummary', payload));

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
  // console.log('new ollama params:', movingParams);
}

function getParams() {
  return {
    temperature: movingParams.temperature,
    top_k: movingParams.top_k,
    top_p: movingParams.top_p,
    min_k: movingParams.min_k
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
  behaviorManager,
  missionPlanner,
  worldModel,
};
