import { socket } from './socketGlobal.js';
import { dom } from './dom.js';

console.log('ollama module loaded');

if (dom.aiStartButton && dom.aiStopButton) {
    dom.aiStartButton.addEventListener('click', () => {
        socket.emit('enableAIMode', { enabled: true });
    });
    dom.aiStopButton.addEventListener('click', () => {
        socket.emit('enableAIMode', { enabled: false });
    });
}

if (dom.goalSubmitButton && dom.goalInput) {
    dom.goalSubmitButton.addEventListener('click', () => {
        const goalText = dom.goalInput.value.trim();
        if (goalText) {
            socket.emit('setGoal', { goal: goalText });
            dom.goalInput.value = '';
        }
    });
}

const movingParams = {
    temperature: 0.7,
    top_k: 40,
    top_p: 0.9,
    min_k: 1
};

function sendParams() {
    socket.emit('ollamaParamsPush', { movingParams });
    console.log('Parameters sent:', movingParams);
}

if (dom.ollamaTemperature) {
    dom.ollamaTemperature.addEventListener('input', (event) => {
        const temperature = parseFloat(event.target.value);
        if (!Number.isNaN(temperature)) {
            movingParams.temperature = temperature;
            sendParams();
        }
    });
}

if (dom.ollamaTopK) {
    dom.ollamaTopK.addEventListener('input', (event) => {
        const topK = parseInt(event.target.value, 10);
        if (!Number.isNaN(topK)) {
            movingParams.top_k = topK;
            sendParams();
        }
    });
}

if (dom.ollamaTopP) {
    dom.ollamaTopP.addEventListener('input', (event) => {
        const topP = parseFloat(event.target.value);
        if (!Number.isNaN(topP)) {
            movingParams.top_p = topP;
            sendParams();
        }
    });
}

if (dom.ollamaMinK) {
    dom.ollamaMinK.addEventListener('input', (event) => {
        const minK = parseInt(event.target.value, 10);
        if (!Number.isNaN(minK)) {
            movingParams.min_k = minK;
            sendParams();
        }
    });
}

if (dom.hideOllamaButton && dom.ollamaAdvancedControls) {
    dom.hideOllamaButton.addEventListener('click', () => {
        const nowHidden = dom.ollamaAdvancedControls.classList.toggle('hidden');
        document.cookie = `ollamaPanelHidden=${nowHidden}; path=/; max-age=31536000`;
    });
}

socket.on('ollamaEnabled', (enabled) => {
    if (!dom.ollamaPanel) return;
    if (enabled) {
        dom.ollamaPanel.classList.remove('hidden');
    } else {
        dom.ollamaPanel.classList.add('hidden');
    }
});

socket.on('ollamaStreamChunk', (chunk) => {
    if (!dom.ollamaResponseText) return;
    dom.ollamaResponseText.innerText += chunk;
    dom.ollamaResponseText.scrollTop = dom.ollamaResponseText.scrollHeight;
});

socket.on('controlLoopIteration', (iterationInfo) => {
    if (!dom.ollamaStatus || !dom.aiSpinner) return;
    if (iterationInfo.status === 'started') {
        if (dom.ollamaResponseText) {
            dom.ollamaResponseText.innerText = '';
        }
        dom.ollamaStatus.innerText = `Processing iteration ${iterationInfo.iterationCount}`;
        dom.ollamaStatus.classList.remove('bg-red-500');
        dom.ollamaStatus.classList.add('bg-blue-500');
        dom.aiSpinner.classList.remove('hidden');
    } else if (iterationInfo.status === 'completed') {
        dom.ollamaStatus.innerText = `Iteration ${iterationInfo.iterationCount} completed`;
        dom.ollamaStatus.classList.remove('bg-blue-500');
        dom.ollamaStatus.classList.add('bg-red-500');
        dom.aiSpinner.classList.add('hidden');
    }
});

socket.on('aiModeEnabled', (enabled) => {
    if (!dom.aiModeStatus || !dom.ollamaStatus || !dom.aiSpinner) return;
    if (enabled) {
        dom.aiModeStatus.innerText = 'Currently Enabled';
        dom.aiModeStatus.classList.remove('bg-red-500');
        dom.aiModeStatus.classList.add('bg-green-500');
    } else {
        dom.aiModeStatus.innerText = 'Currently Disabled';
        dom.aiModeStatus.classList.remove('bg-green-500');
        dom.aiModeStatus.classList.add('bg-red-500');

        dom.ollamaStatus.innerText = 'Not Processing';
        dom.ollamaStatus.classList.remove('bg-blue-500');
        dom.ollamaStatus.classList.add('bg-red-500');

        dom.aiSpinner.classList.add('hidden');
    }
});

socket.on('newGoal', (goalText) => {
    if (!dom.goalText) return;
    dom.goalText.innerText = `Current Goal: ${goalText}`;
});

socket.on('ollamaParamsRelay', (params) => {
    if (!params) return;
    if (typeof params.temperature === 'number' && dom.ollamaTemperature) {
        dom.ollamaTemperature.value = params.temperature;
        movingParams.temperature = params.temperature;
    }
    if (typeof params.top_k === 'number' && dom.ollamaTopK) {
        dom.ollamaTopK.value = params.top_k;
        movingParams.top_k = params.top_k;
    }
    if (typeof params.top_p === 'number' && dom.ollamaTopP) {
        dom.ollamaTopP.value = params.top_p;
        movingParams.top_p = params.top_p;
    }
    if (typeof params.min_k === 'number' && dom.ollamaMinK) {
        dom.ollamaMinK.value = params.min_k;
        movingParams.min_k = params.min_k;
    }
});
