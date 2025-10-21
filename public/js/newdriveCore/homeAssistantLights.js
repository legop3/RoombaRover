import { socket } from '../modules/socketGlobal.js';
import { featureEnabled } from '../modules/features.js';

export let numberOfLights = 0;

const canControlLights = featureEnabled('allowLightControl', true);
const lightContainers = Array.from(document.querySelectorAll('[data-room-lights]'));

let previousStatesJson = null;

function createLightButton(index, state) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rounded-md p-1 bg-yellow-500 text-xs hover:opacity-90 transition';
  button.innerHTML = `
    <p class="text-xl">Room Light ${index + 1}</p>
    <p>${canControlLights ? 'Click to toggle light' : ''}</p>
    <p class="${state ? 'bg-green-500' : 'bg-red-500'} rounded-xl mt-1" data-room-light-status>
      ${state ? 'On' : 'Off'}
    </p>
  `;

  if (canControlLights) {
    button.addEventListener('click', () => {
      socket.emit('light_switch', { index, state: !state });
    });
  } else {
    button.disabled = true;
    button.classList.add('cursor-not-allowed', 'opacity-70');
  }

  return button;
}

function renderLights(states) {
  lightContainers.forEach((container) => {
    container.replaceChildren();
    if (!Array.isArray(states) || !states.length) {
      const placeholder = document.createElement('p');
      placeholder.className = 'text-sm text-center text-gray-300';
      placeholder.textContent = 'No lights available.';
      container.appendChild(placeholder);
      return;
    }

    states.forEach((state, index) => {
      container.appendChild(createLightButton(index, Boolean(state)));
    });
  });
}

socket.on('light_states', (states) => {
  const serializedStates = JSON.stringify(states ?? []);
  if (serializedStates === previousStatesJson) {
    return;
  }
  previousStatesJson = serializedStates;

  if (!Array.isArray(states) || !states.length) {
    numberOfLights = 0;
    renderLights([]);
    return;
  }

  numberOfLights = states.length;
  renderLights(states);
});
