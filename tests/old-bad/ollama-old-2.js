const {driveDirect, playRoombaSong, RoombaController} = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config');
const { getLatestFrontFrame } = require('./CameraStream'); // Import the function to get camera image
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const chatPrompt = fs.readFileSync('./prompts/chat.txt', 'utf8').trim();
const systemPrompt = fs.readFileSync('./prompts/system.txt', 'utf8').trim();
const roombaStatus = require('./roombaStatus'); // Import the roombaStatus module

// Import the Ollama class
const { Ollama } = require('ollama');
// Create a client instance with the external server URL
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` });
const controller = new RoombaController(port);

let iterationCount = 0;
let lastResponse = ''


// Enhanced streaming function with real-time command parsing
async function streamChatFromCameraImage(cameraImageBase64) {

  const constructChatPrompt = 
  `**Step ${iterationCount}**\n
  **Your last response was:**\n
  ${lastResponse}\n
  **bump_left:** ${roombaStatus.bumpSensors.bumpLeft}\n
  **bump_right:** ${roombaStatus.bumpSensors.bumpRight}\n
  ${chatPrompt}`;


  console.log('Constructed chat prompt:', constructChatPrompt);
  
  try {
    console.log('Starting streaming chat with Ollama...');
    console.log('Camera image base64 length:', cameraImageBase64 ? cameraImageBase64.length : 'No image provided');
    
    // Ensure we have a valid base64 image
    if (!cameraImageBase64) {
      console.warn('No camera image provided, proceeding without image');
    }
    
    // Prepare the user message
    const userMessage = {
      role: 'user',
      content: constructChatPrompt
    };
    
    // Only add images array if we have a valid image
    if (cameraImageBase64 && cameraImageBase64.length > 0) {
      // Remove data URL prefix if present (data:image/jpeg;base64,)
      const cleanBase64 = cameraImageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      userMessage.images = [cleanBase64];
      console.log('Added image to message, clean base64 length:', cleanBase64.length);
    }
    
    console.log('Sending request to Ollama...');
    const response = await ollama.chat({
      model: config.ollama.modelName,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        userMessage,
      ],
      stream: true, // Enable streaming
      keep_alive: -1
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
        // Continue processing other chunks
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
    
    
    return fullResponse;
  } catch (error) {
    console.error('Error in streaming chat:', error);
    console.error('Error stack:', error.stack);
    AIControlLoop.emit('streamError', error);
    throw error; // Re-throw so the caller can handle it
  }
}

// Enhanced command parsing for streaming content
function parseCommandsFromBuffer(buffer) {
  const commands = [];
  const commandRegex = /\[(forward|backward|left|right|strafeLeft|strafeRight|say speak) ([^\]]+)\]/g;
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

// Enhanced command execution
function runCommands(commands) {
  commands.forEach(command => {
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
      case 'say speak':
        const sentence = command.value;
        if (sentence && sentence.length > 0) {
          console.log(`Saying: ${sentence}`);
          speak(sentence);
        } else {
          console.error(`Invalid say command value: ${command.value}`);
        }
        break;
      default:
        console.error(`Unknown command action: ${command.action}`);
    }
  });
}

// Legacy command parsing function (kept for compatibility)
function parseCommands(responseText) {
  const commands = [];
  try {
    const commandRegex = /\[(forward|backward|left|right|strafeLeft|strafeRight|say speak) ([^\]]+)\]/g;
    let match;
    while ((match = commandRegex.exec(responseText)) !== null) {
      const action = match[1];
      const value = match[2];
      commands.push({ action, value });
    }
    runCommands(commands);
  } catch (err) {
    console.error('Error parsing commands:', err);
    return commands;
  }
  return commands;
}

// Enhanced AI Control Loop Class with streaming support
class AIControlLoopClass extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.streamingMode = true; // Enable streaming by default
  }

  async start(useStreaming = true) {
    if (this.isRunning) {
      console.log('Robot control loop is already running.');
      return;
    }
    this.emit('aiModeStatus', true)
    
    this.isRunning = true;
    this.streamingMode = useStreaming;
    console.log(`Robot control loop started in ${useStreaming ? 'streaming' : 'batch'} mode.`);
    
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
          // Continue without image or use a fallback
          cameraImage = null;
        }
        
        if (this.streamingMode) {
          // Use streaming mode
          console.log('Starting streaming mode...');
          try {
            await streamChatFromCameraImage(cameraImage);
            console.log('Streaming completed successfully');
          } catch (streamError) {
            console.error('Streaming error:', streamError);
            this.emit('streamError', streamError);
            // Continue the loop instead of breaking
          }
        } else {
          // Use legacy batch mode
          console.log('Starting batch mode...');
          try {
            const response = await this.runChatFromCameraImageBatch(cameraImage);
            if (!response) {
              console.log('No response received, continuing...');
              continue;
            }
            console.log('Ollama says:', response);
            this.emit('ollamaResponse', response);
            const commands = parseCommands(response);
            lastResponse = response; // Store the last response for future iterations
            if (commands.length === 0) {
              console.log('No movement commands detected.');
            }
          } catch (batchError) {
            console.error('Batch mode error:', batchError);
            this.emit('controlLoopError', batchError);
            // Continue the loop instead of breaking
          }
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
          // Continue anyway
        }
        
        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log(`=== End of Iteration ${iterationCount} ===\n`);
        this.emit('controlLoopIteration', { iterationCount, status: 'completed' });

        
      } catch (err) {
        console.error(`Error in control loop iteration ${iterationCount}:`, err);
        console.error('Stack trace:', err.stack);
        this.emit('controlLoopError', err);
        
        // Add a delay before retrying to prevent rapid error loops
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Continue the loop instead of breaking
        console.log('Continuing after error...');
      }
    }
    
    console.log('Robot control loop stopped.');
  }

  // Legacy batch mode function (kept for compatibility)
  async runChatFromCameraImageBatch(cameraImageBase64) {

    const constructChatPrompt = 
    `**Step ${iterationCount}**\n
    **Your last response was:**\n
    ${lastResponse}\n
    **bump_left:** ${roombaStatus.bumpSensors.bumpLeft}\n
    **bump_right:** ${roombaStatus.bumpSensors.bumpRight}\n
    ${chatPrompt}`;   

    try {
      console.log('Talking to Ollama with camera image...');
      console.log('Camera image base64 length:', cameraImageBase64 ? cameraImageBase64.length : 'No image provided');
      
      // Prepare the user message
      const userMessage = {
        role: 'user',
        content: constructChatPrompt
      };
      
      // Only add images array if we have a valid image
      if (cameraImageBase64 && cameraImageBase64.length > 0) {
        // Remove data URL prefix if present (data:image/jpeg;base64,)
        const cleanBase64 = cameraImageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        userMessage.images = [cleanBase64];
        console.log('Added image to batch message, clean base64 length:', cleanBase64.length);
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
        keep_alive: -1
      });
      
      return response.message.content;
    } catch (error) {
      console.error('Error talking to Ollama:', error.message || error);
      throw error;
    }
  }

  stop() {
    if (!this.isRunning) {
      console.log('Robot control loop is not running.');
      return;
    }
    this.isRunning = false;
    // this.emit('controlLoopStopped');
    this.emit('aiModeStatus', false)

  }

  // Method to toggle between streaming and batch modes
  setStreamingMode(enabled) {
    this.streamingMode = enabled;
    console.log(`Streaming mode ${enabled ? 'enabled' : 'disabled'}`);
  }
}

const AIControlLoop = new AIControlLoopClass();

// Export the enhanced functions
module.exports = {
  streamChatFromCameraImage,
  runChatFromCameraImage: AIControlLoop.runChatFromCameraImageBatch.bind(AIControlLoop), // Legacy compatibility
  AIControlLoop,
  speak,
  parseCommands,
  runCommands
};