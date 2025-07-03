// You are controlling a robot exploring a new environment. Be curious. Based on the image from the robot’s camera, what direction should the robot go? use instructions like [forward] [backward] to move the robot forward and backward, and [left] and [right] to steer the robot left and right (tank steering). only state commands if you want the robot to follow them. 

const {driveDirect, playRoombaSong, RoombaController} = require('./roombaCommands');
const { port, tryWrite } = require('./serialPort');
const config = require('./config.json');
const { getLatestFrontFrame } = require('./CameraStream'); // Import the function to get camera image
const { spawn } = require('child_process');
const EventEmitter = require('events');

const fs = require('fs');
const chatPrompt = fs.readFileSync('./prompts/chat.txt', 'utf8').trim();
const systemPrompt = fs.readFileSync('./prompts/system.txt', 'utf8').trim();

// Set the Ollama server URL programmatically
// process.env.OLLAMA_HOST = 'http://192.168.0.22:11434'; // Replace with your external server IP or hostname

// Import the Ollama class
const { Ollama } = require('ollama');

// Create a client instance with the external server URL
const ollama = new Ollama({ host: `${config.ollama.serverURL}:${config.ollama.serverPort}` }); // ← Replace with your Ollama server IP

const controller = new RoombaController(port);

// function tryWrite(port, command) {

//     try {
//         port.write(Buffer.from(command));
//         // console.log('Command written to port:', command);
//     }
//     catch (err) {
//         console.error('Error writing to port:', err.message);
//     }
// }





async function runChatFromCameraImage(cameraImageBase64) {
  try {
    console.log('Talking to Ollama with camera image...');
    console.log('Camera image base64 length:', cameraImageBase64.length);
    const response = await ollama.chat({
      model: config.ollama.modelName, // Replace with your desired model
      messages: [
        {
            role: 'system',
            content: systemPrompt, // System prompt to set the context
        },
        { 
            role: 'user', 
            content: chatPrompt,
            images: [cameraImageBase64] // Base64 encoded image from the camera
        },
      ],
    });

    // console.log('Ollama says (from rcfci): ', response.message.content);
    // console.log('parsing commands from response..')
    return response.message.content; // Return the response text

  } catch (error) {
    console.error('Error talking to Ollama:', error.message || error);
  }
}


// runChatFromCameraImage();

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
  const espeak = spawn('espeak', [text]);

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

// speak('speaking test')
// speak('speaking test 2')

function runCommands(commands) {




    commands.forEach(command => {
        switch (command.action) {
            case 'forward':
                const forwardMeters = parseFloat(command.value);
                if (!isNaN(forwardMeters)) {
                    console.log(`Moving forward ${forwardMeters} meters at 500 mm/s`);
                    controller.move(forwardMeters, 0)
                } else {
                    console.error(`Invalid forward command value: ${command.value}`);
                }
                break;
            case 'backward':
                const backwardMeters = parseFloat(command.value);
                if (!isNaN(backwardMeters)) {
                    console.log(`Moving backward ${backwardMeters} meters at 500 mm/s`);
                    controller.move(-backwardMeters, 0)
                } else {
                    console.error(`Invalid backward command value: ${command.value}`);
                }
                break;
            case 'left':
                const leftAngle = parseFloat(command.value);
                if (!isNaN(leftAngle)) {
                    console.log(`Turning left ${leftAngle} degrees at 500 mm/s`);
                    controller.move(0, leftAngle)
                } else {
                    console.error(`Invalid left command value: ${command.value}`);
                }
                break;
            case 'right':
                const rightAngle = parseFloat(command.value);
                if (!isNaN(rightAngle)) {
                    console.log(`Turning right ${rightAngle} degrees at 500 mm/s`);
                    controller.move(0, -rightAngle)
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


function parseCommands(responseText) {
    const commands = [];
    try {
        //parse commaands and run them: [forward <meters>], [backward <meters>], [left <angle>] and [right <angle>] to steer the robot left and right, [strafeLeft <meters>] and [strafeRight <meters>] to move diagonally, [say speak <sentence>] to say somthing as the robot.
        const commandRegex = /\[(forward|backward|left|right|strafeLeft|strafeRight|say speak) ([^\]]+)\]/g;
        let match;
        while ((match = commandRegex.exec(responseText)) !== null) {
            const command = match[0]; // Full command including brackets
            const action = match[1]; // Action type (forward, backward, etc.)
            const value = match[2]; // Value associated with the action (e.g., meters, angle, sentence)
            
            // Add the command to the list
            commands.push({ action, value });


        }
        runCommands(commands)


    } catch (err) {
        console.error('Error parsing commands:', err);
        return commands; // Return empty commands on error
    }

    return commands;
  }


class AIControlLoopClass extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
  }

  async start() {


    // const controller = new RoombaController(port);
    // controller.move(0, 20)
    // controller.move(20, 0)


    if (this.isRunning) {
      console.log('Robot control loop is already running.');
      return;
    }

    this.isRunning = true;
    console.log('Robot control loop started.');
    tryWrite(port, [131]) // tell roomba to enter safe mode

    while (this.isRunning) {
      try {
        const response = await runChatFromCameraImage(getLatestFrontFrame());
        if (!response) continue;

        console.log('Ollama says:', response);
        this.emit('ollamaResponse', response); // ✅ Emit event with Ollama's output

        const commands = parseCommands(response);
        if (commands.length) {
          // executeCommands(commands);
        } else {
          console.log('No movement commands detected.');
        }

        await new Promise((resolve) =>
          setTimeout(resolve, config.ollama.loopDelay || 3000)
        );
      } catch (err) {
        console.error('Error in control loop:', err);
      }
    }

    console.log('Robot control loop stopped.');
  }

  stop() {
    if (!this.isRunning) {
      console.log('Robot control loop is not running.');
      return;
    }
    this.isRunning = false;
  }
}

const AIControlLoop = new AIControlLoopClass();




module.exports = {
    runChatFromCameraImage,
    AIControlLoop,
}

