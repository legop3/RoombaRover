import { socket } from './socketGlobal.js';
import { numberOfLights } from './homeAssistantLights.js';

console.log("driverControls module loaded");

// Joystick control stuff
const joystick = nipplejs.create({
    zone: document.getElementById('joystick'),
    mode: 'dynamic',
    // position: { left: '50%', top: '50%' },
    color: 'pink',
    size: '200'
});

// wheel speed calculations
const MAX_SPEED = 200
joystick.on('move', function (evt, data) {
    if (!data || !data.distance || !data.angle) return;
    let leftSpeed = data.vector.y * MAX_SPEED + data.vector.x * MAX_SPEED;
    let rightSpeed = data.vector.y * MAX_SPEED - data.vector.x * MAX_SPEED;

    leftSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, leftSpeed));
    rightSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, rightSpeed));

    leftSpeed = Math.round(leftSpeed);
    rightSpeed = Math.round(rightSpeed);

    // console.log(data.vector.x, data.vector.y);
    // console.log(`Left: ${leftSpeed}, Right: ${rightSpeed}`);

    // rate limit this to every 100ms
    if (this.lastEmit && (Date.now() - this.lastEmit) < 200) return;
    this.lastEmit = Date.now();

    // emit the speeds

    socket.emit('Speedchange', { leftSpeed, rightSpeed});
});

joystick.on('end', function () {
    socket.emit('Speedchange', { leftSpeed: 0, rightSpeed: 0 });
});

// handle events from aux motor buttons on the joystick card
const brushForwardButton = document.getElementById('brushForwardButton');
const brushReverseButton = document.getElementById('brushReverseButton');
const vacuumMotorButton = document.getElementById('vacuumMotorButton');
const mainBrushForwardButton = document.getElementById('mainBrushForwardButton');
const mainBrushReverseButton = document.getElementById('mainBrushReverseButton');

if (brushForwardButton) {
    brushForwardButton.addEventListener('pointerdown', () => {
        socket.emit('sideBrush', { speed: 127 });
    });
    brushForwardButton.addEventListener('pointerup', () => {
        socket.emit('sideBrush', { speed: 0 });
    });
    brushForwardButton.addEventListener('pointerleave', () => {
        socket.emit('sideBrush', { speed: 0 });
    });
    brushForwardButton.addEventListener('pointercancel', () => {
        socket.emit('sideBrush', { speed: 0 });
    });
}

if (brushReverseButton) {
    brushReverseButton.addEventListener('pointerdown', () => {
        socket.emit('sideBrush', { speed: -127 });
    });
    brushReverseButton.addEventListener('pointerup', () => {
        socket.emit('sideBrush', { speed: 0 });
    });
    brushReverseButton.addEventListener('pointerleave', () => {
        socket.emit('sideBrush', { speed: 0 });
    });
    brushReverseButton.addEventListener('pointercancel', () => {
        socket.emit('sideBrush', { speed: 0 });
    });
}

if (vacuumMotorButton) {
    vacuumMotorButton.addEventListener('pointerdown', () => {
        socket.emit('vacuumMotor', { speed: 127 });
    });
    vacuumMotorButton.addEventListener('pointerup', () => {
        socket.emit('vacuumMotor', { speed: 0 });
    });
    vacuumMotorButton.addEventListener('pointerleave', () => {
        socket.emit('vacuumMotor', { speed: 0 });
    });
    vacuumMotorButton.addEventListener('pointercancel', () => {
        socket.emit('vacuumMotor', { speed: 0 });
    });
}

if (mainBrushForwardButton) {
    mainBrushForwardButton.addEventListener('pointerdown', () => {
        socket.emit('brushMotor', { speed: 127 });
    });
    mainBrushForwardButton.addEventListener('pointerup', () => {
        socket.emit('brushMotor', { speed: 0 });
    });
    mainBrushForwardButton.addEventListener('pointerleave', () => {
        socket.emit('brushMotor', { speed: 0 });
    });
    mainBrushForwardButton.addEventListener('pointercancel', () => {
        socket.emit('brushMotor', { speed: 0 });
    });
}

if (mainBrushReverseButton) {
    mainBrushReverseButton.addEventListener('pointerdown', () => {
        socket.emit('brushMotor', { speed: -127 });
    });
    mainBrushReverseButton.addEventListener('pointerup', () => {
        socket.emit('brushMotor', { speed: 0 });
    });
    mainBrushReverseButton.addEventListener('pointerleave', () => {
        socket.emit('brushMotor', { speed: 0 });
    });
    mainBrushReverseButton.addEventListener('pointercancel', () => {
        socket.emit('brushMotor', { speed: 0 });
    });
}


// mode controls for layman
function easyStart() { 
    socket.emit('easyStart');
    for (let i = 0; i < numberOfLights; i++) {
        socket.emit('light_switch', { index: i, state: true });
    }
}
window.easyStart = easyStart;

function easyDock() { socket.emit('easyDock'); }
window.easyDock = easyDock;

// keyboard control stuff
// REALLY need to add options for multiple keyboard layouts here


// key handler function
const pressedKeys = new Set();
function handleKeyEvent(event, isKeyDown) {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'shift', '\\'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        var speeds = keySpeedCalculator(pressedKeys);
        // console.log(`Left: ${speeds.leftSpeed}, Right: ${speeds.rightSpeed}`);
        speeds.timestamp = Date.now();
        socket.emit('Speedchange', speeds);
    }

    // key controls for side brush
    if (['o', 'l'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;
        let speed = 0;

        if (pressedKeys.has('o')) speed = 127
        if (pressedKeys.has('l')) speed = -50
        if (!pressedKeys.has('o') && !pressedKeys.has('l')) speed = 0

        socket.emit('sideBrush', { speed: speed })

    } 

    //key controls for vacuum motor
    if (['i', 'k'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;
        let speed = 0;

        if (pressedKeys.has('i')) speed = 127
        if (pressedKeys.has('k')) speed = 20
        if (!pressedKeys.has('i') && !pressedKeys.has('k')) speed = 0

        socket.emit('vacuumMotor', { speed: speed })

    }

    // key controls for brush motor
    if (['p', ';'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;
        let speed = 0;

        if (pressedKeys.has('p')) speed = 127
        if (pressedKeys.has(';')) speed = -50
        if (!pressedKeys.has('p') && !pressedKeys.has(';')) speed = 0

        socket.emit('brushMotor', { speed: speed })
    }

    //control for all motors at once
    if (['.'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;
        let speed = 0;

        if (pressedKeys.has('.')) speed = 127
        if (!pressedKeys.has('.')) speed = 0

        socket.emit('sideBrush', {speed: speed})
        socket.emit('vacuumMotor', {speed: speed})
        socket.emit('brushMotor', {speed: speed})
    }

    //press enter to start typing a message, then press enter again to send it
    // let inputFocused = false
    let sendButton = document.getElementById('sendMessageButton')
    let messageInput = document.getElementById('messageInput')
    if (['enter'].includes(key)) {
        if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
        else if (!isKeyDown) pressedKeys.delete(key);
        else return;

        if (document.activeElement === messageInput && isKeyDown) {
            sendButton.click()
            if (messageInput.value === '') {
                messageInput.blur()
            }
            messageInput.blur()
        } else if (document.activeElement !== messageInput && isKeyDown) {
            messageInput.focus()

        }
    }
}

document.addEventListener('keydown', e => handleKeyEvent(e, true));
document.addEventListener('keyup', e => handleKeyEvent(e, false));

function keySpeedCalculator(keys) {
    const baseSpeed = 100;
    const fast = 2.5, slow = 0.5;
    let left = 0, right = 0, mult = 1;
    if (keys.has('\\')) mult = fast;
    else if (keys.has('shift')) mult = slow;
    if (keys.has('w')) left += baseSpeed, right += baseSpeed;
    if (keys.has('s')) left -= baseSpeed, right -= baseSpeed;
    if (keys.has('a')) left -= baseSpeed, right += baseSpeed;
    if (keys.has('d')) left += baseSpeed, right -= baseSpeed;
    return { leftSpeed: left * mult, rightSpeed: right * mult };
}
