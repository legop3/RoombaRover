import { socket } from './socketGlobal.js';
import { featureEnabled } from './features.js';

console.log("homeAssistantLights module loaded");

const lightButtonContainer = document.getElementById('light-button-container');
var old_states = [];
var numberOfLights = 0;
const canControlLights = featureEnabled('allowLightControl', true);

socket.on('light_states', states => {
    if (!lightButtonContainer) return;
    // console.log('light states', states);
    numberOfLights = states.length
    if (JSON.stringify(states) === JSON.stringify(old_states)) return; // Only update if states have changed
    old_states = JSON.parse(JSON.stringify(states)); // Create a deep copy of states

    if (!Array.isArray(states) || states.length === 0) return;
    lightButtonContainer.innerHTML = '';
    console.log('drawing buttons. old states: ', old_states);

    states.forEach((state, index) => {
        const statusText = canControlLights ? 'Click to toggle light' : '';
        const button = document.createElement('button');
        button.id = `room-light-${index + 1}-button`;
        button.className = `rounded-md p-1 px-2 bg-yellow-500 text-xs hover:opacity-90`;
        button.innerHTML = 
        `<p class="text-xl">Room Light ${index + 1}</p>
        <p>${statusText}</p>
        <p class="${state ? 'bg-green-500' : 'bg-red-500'} rounded-xl mt-1" id="room-lights-status">${state ? 'On' : 'Off'}</p>`;
        if (canControlLights) {
            button.addEventListener('click', () => {
                socket.emit('light_switch', { index, state: !state });
            });
        } else {
            button.disabled = true;
            button.classList.add('cursor-not-allowed', 'opacity-70');
        }
        lightButtonContainer.appendChild(button);
    });
});

export { numberOfLights };
