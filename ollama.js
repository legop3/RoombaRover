const {driveDirect, playRoombaSong, RoombaController} = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const chatPrompt = fs.readFileSync('./prompts/chat.txt', 'utf8').trim();
const systemPrompt = fs.readFileSync('./prompts/system.txt', 'utf8').trim();
const discordCaptionPrompt = fs.readFileSync('./prompts/discord-caption.txt', 'utf8').trim();
const roombaStatus = require('./roombaStatus');
const { Ollama } = require('ollama');

// Create a client instance with the external server URL
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });
const controller = new RoombaController(port);
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
  min_k: config.ollama.parameters.min_k || 1
}

let movingParams = defaultParams;


// Streaming function with real-time command parsing
async function streamChatFromCameraImage(cameraImageBase64) {

Object.entries(roombaStatus.lightBumps).forEach((value, key) => {
  console.log(`Light bump sensor ${key}: ${value[1]}`);
  
  // emulate bump sensors based on light bump values
  // if((value[1] > 100) && (value[0] == 'LBL' || value[0] == 'LBFL' || value[0] == 'LBCL')) {
  //   console.log('obstacle on left')
  //   roombaStatus.bumpSensors.bumpLeft = 'ON';
  //   setGoal('Back up and turn right to avoid obstacle detected on the left');
  //   // currentGoal = 'Avoid left obstacle';
  // } else {
  //   roombaStatus.bumpSensors.bumpLeft = 'OFF';
  // }

  // if((value[1] > 100) && (value[0] == 'LBR' || value[0] == 'LBFR' || value[0] == 'LBCR')) {
  //   console.log('obstacle on right')
  //   roombaStatus.bumpSensors.bumpRight = 'ON';
  //   setGoal('Back up and turn left to avoid obstacle detected on the right');
  //   // currentGoal = 'Avoid right obstacle';
  // } else {
  //   roombaStatus.bumpSensors.bumpRight = 'OFF';
  // }
  

});

// save for later
// collision_sensors:
// - left: ${roombaStatus.lightBumps.LBL}
// - front_left: ${roombaStatus.lightBumps.LBFL}
// - center_left: ${roombaStatus.lightBumps.LBCL}
// - center_right: ${roombaStatus.lightBumps.LBCR}
// - front_left: ${roombaStatus.lightBumps.LBFR}
// - right: ${roombaStatus.lightBumps.LBR}


const constructChatPrompt = `
last_command: ${lastCommand || 'No previous command.'}
bump_left: ${roombaStatus.bumpSensors.bumpLeft}
bump_right: ${roombaStatus.bumpSensors.bumpRight}
current_goal: ${currentGoal || 'Explore your environment. Set a new goal using the [new_goal] command.'}
${chatPrompt}`;

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
        if (goalText && goalText.length > 0) {
          console.log(`Setting goal: ${goalText}`);
          currentGoal = goalText;
          AIControlLoop.emit('goalSet', goalText);
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
            new Promise((resolve) => setTimeout(resolve, 10000)) // 10 second timeout
          ]);
          console.log('Roomba queue empty or timeout reached');
        } catch (queueError) {
          console.error('Error waiting for roomba queue:', queueError);
        }
        
        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
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

async function generateImageDescription(imageBase64) {
  if (!config.ollama.enabled) {
    throw new Error('Ollama integration is disabled on the server.');
  }

  if (!imageBase64) {
    throw new Error('No camera frame is available right now.');
  }

  try {
    const response = await ollama.chat({
      model: config.ollama.modelName,
      messages: [
        {
          role: 'system',
          content: discordCaptionPrompt,
        },
        {
          role: 'user',
          content: 'Describe this live camera moment for Discord friends.',
          images: [imageBase64],
        },
      ],
      stream: false,
      keep_alive: -1,
      options: {
        temperature: defaultParams.temperature,
        top_k: defaultParams.top_k,
        top_p: defaultParams.top_p,
        min_k: defaultParams.min_k,
      },
    });

    const caption = response?.message?.content?.trim();
    if (!caption) {
      throw new Error('Ollama did not return a description for the snapshot.');
    }

    return caption.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('Failed to generate Discord caption with Ollama:', error);
    throw error;
  }
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
  generateImageDescription,
};
