// Cache DOM elements once after the DOM is ready
const dom = {
    oiMode: document.getElementById('oi-mode'),
    dockStatus: document.getElementById('dock-status'),
    chargeStatus: document.getElementById('charge-status'),
    batteryUsage: document.getElementById('battery-usage'),
    batteryVoltage: document.getElementById('battery-voltage'),
        brushCurrent: document.getElementById('brush-current'),
        batteryCurrent: document.getElementById('battery-current'),
        cpuUsage: document.getElementById('cpu-usage'),
        memoryUsage: document.getElementById('memory-usage'),
        bumpSensors: {
            L: document.getElementById('lightbump-L'),
            FL: document.getElementById('lightbump-FL'),
            CL: document.getElementById('lightbump-CL'),
            CR: document.getElementById('lightbump-CR'),
        FR: document.getElementById('lightbump-FR'),
        R: document.getElementById('lightbump-R')
    },
    cliffSensors: {
        L: document.getElementById('cliff-L'),
        FL: document.getElementById('cliff-FL'),
        FR: document.getElementById('cliff-FR'),
        R: document.getElementById('cliff-R'),
    },
    leftCurrentBar: document.getElementById('leftCurrent-bar'),
    rightCurrentBar: document.getElementById('rightCurrent-bar'),
    startButtonMessage: document.getElementById('start-button-message'),
    dockButtonMessage: document.getElementById('dock-button-message'),
    dockButtonChargingMessage: document.getElementById('dock-button-charging-message'),
    bumpLeft: document.getElementById('bump-left'),
    bumpRight: document.getElementById('bump-right'),
    dropLeft: document.getElementById('drop-left'),
    dropRight: document.getElementById('drop-right'),
    userCount: document.getElementById('user-counter'),
        mainBrushCurrent: document.getElementById('main-brush-current'),
        dirtDetect: document.getElementById('dirt-detect'),
        overcurrentWarning: document.getElementById('overcurrent-warning'),
        chargeWarning: document.getElementById('charge-warning'),
        overcurrentStatus: document.getElementById('overcurrent-status'),
        chatMessagesCard: document.getElementById('chat-messages-card'),
        chatMessagesList: document.getElementById('chat-messages-list'),
        turnQueueCard: document.getElementById('turn-queue-card'),
        turnQueueYourStatus: document.getElementById('turn-queue-your-status'),
        turnQueueCountdown: document.getElementById('turn-queue-countdown'),
        turnQueueList: document.getElementById('turn-queue-list'),
        nicknameInput: document.getElementById('nickname-input'),
        nicknameSaveButton: document.getElementById('nickname-save-button'),
        nicknameStatus: document.getElementById('nickname-status'),
        discordInviteButton: document.getElementById('discord-invite-button'),
        discordInviteButtonOverlay: document.getElementById('discord-invite-button-overlay')
    // wallSignal: document.getElementById('wall-distance')
    };
    
    // const CLIENT_KEY_STORAGE_KEY = 'roombarover:client-key';
    
    // function generateClientKey() {
    //     if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    //         const bytes = new Uint8Array(16);
    //         window.crypto.getRandomValues(bytes);
    //         return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    //     }
    //     return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    // }
    
    // function getOrCreateClientKey() {
    //     try {
    //         let key = localStorage.getItem(CLIENT_KEY_STORAGE_KEY);
    //         if (typeof key === 'string' && key.trim()) {
    //             return key.trim();
    //         }
    //         key = generateClientKey();
    //         localStorage.setItem(CLIENT_KEY_STORAGE_KEY, key);
    //         return key;
    //     } catch (error) {
    //         console.warn('client key storage unavailable', error);
    //         return generateClientKey();
    //     }
    // }
    
    // const clientKey = getOrCreateClientKey();
    
    // var socket = io({
    //     auth: {
    //         clientKey,
    //     },
    // })
    var socket = io('/spectate');
    
    let selfId = null;
    
    const MAX_CHAT_MESSAGES = 20;
    const NICKNAME_STORAGE_KEY = 'roombarover:nickname';
    let currentNickname = '';
    let desiredNickname = localStorage.getItem(NICKNAME_STORAGE_KEY) || '';
    
    if (dom.nicknameInput && desiredNickname) {
        dom.nicknameInput.value = desiredNickname;
    }
    
    function updateChargeAlertOverlay(alertPayload) {
        if (!dom.chargeWarning) return;
        if (alertPayload && alertPayload.active && alertPayload.message) {
            dom.chargeWarning.textContent = alertPayload.message;
            dom.chargeWarning.classList.remove('hidden');
        } else {
            dom.chargeWarning.textContent = '';
            dom.chargeWarning.classList.add('hidden');
        }
    }
    
    // socket.on('auth-init', (message) => {
    
    //     console.log('not authenticated')
        //show login modal
        // document.getElementById('password-form').classList.remove('hidden');
    
    
    // const overlayForm = document.getElementById('password-form');
    // const overlayInput = document.getElementById('password-input');
    // const inlineForm = document.getElementById('inline-password-form');
    // const inlineInput = document.getElementById('inline-password-input');
    
    // function handleLogin(form, input) {
    //     form.addEventListener('submit', (event) => {
    //         event.preventDefault();
    //         const password = input.value.trim();
    
    //         console.log(`attempting login ${password}`);
    
    //         if (password) {
    //             socket.auth = { clientKey, token: password };
    //             socket.disconnect();
    //             socket.connect();
    
    //             if (form === overlayForm) {
    //                 document.getElementById('overlay').classList.add('hidden');
    //             }
    //         }
    //     });
    // }
    
    // handleLogin(overlayForm, overlayInput);
    // handleLogin(inlineForm, inlineInput);
    
    
    
    // })
    
    // function applyUiConfig(data = {}) {
    //     const inviteButton = dom.discordInviteButton;
    //     const inviteButtonOverlay = dom.discordInviteButtonOverlay;
    //     if (!inviteButton) return;
    
    //     const inviteURL = typeof data.discordInviteURL === 'string' ? data.discordInviteURL.trim() : '';
    
    //     if (inviteURL) {
    //         inviteButton.href = inviteURL;
    //         inviteButton.classList.remove('hidden');
    //         inviteButton.removeAttribute('aria-disabled');
    
    //         inviteButtonOverlay.href = inviteURL;
    //     } else {
    //         inviteButton.href = '#';
    //         inviteButton.classList.add('hidden');
    //         inviteButton.setAttribute('aria-disabled', 'true');
    //     }
    // }
    
    // socket.on('ui-config', applyUiConfig);
    
    // async function fetchDiscordInvite() {
    //     try {
    //         const response = await fetch('/discord-invite', { cache: 'no-store' });
    //         if (!response.ok) {
    //             console.warn('Failed to fetch Discord invite', response.status, response.statusText);
    //             return;
    //         }
    
    //         const inviteURL = (await response.text()).trim();
    //         applyUiConfig({ discordInviteURL: inviteURL });
    //     } catch (error) {
    //         console.warn('Failed to fetch Discord invite', error);
    //     }
    // }
    
    // fetchDiscordInvite();
    
    
    // function setNicknameStatus(message, type = 'info') {
    //     if (!dom.nicknameStatus) return;
    
    //     if (!message) {
    //         dom.nicknameStatus.textContent = '';
    //         dom.nicknameStatus.classList.add('hidden');
    //         dom.nicknameStatus.classList.remove('text-red-300', 'text-green-300', 'text-gray-200');
    //         return;
    //     }
    
    //     dom.nicknameStatus.classList.remove('hidden');
    //     dom.nicknameStatus.textContent = message;
    
    //     dom.nicknameStatus.classList.remove('text-red-300', 'text-green-300', 'text-gray-200');
    //     if (type === 'error') {
    //         dom.nicknameStatus.classList.add('text-red-300');
    //     } else if (type === 'success') {
    //         dom.nicknameStatus.classList.add('text-green-300');
    //     } else {
    //         dom.nicknameStatus.classList.add('text-gray-200');
    //     }
    // }
    
    // function requestNicknameUpdate(rawNickname) {
    //     const trimmed = typeof rawNickname === 'string' ? rawNickname.trim() : '';
    //     if (!trimmed) {
    //         setNicknameStatus('Nickname cannot be empty.', 'error');
    //         return;
    //     }
    
    //     if (trimmed.length > 24) {
    //         setNicknameStatus('Nickname must be 24 characters or fewer.', 'error');
    //         return;
    //     }
    
    //     if (trimmed === currentNickname) {
    //         setNicknameStatus('Nickname is already set.', 'info');
    //         return;
    //     }
    
    //     desiredNickname = trimmed;
    
    //     if (!socket.connected) {
    //         setNicknameStatus('Saving when connection restores...', 'info');
    //         return;
    //     }
    
    //     socket.emit('setNickname', trimmed);
    //     setNicknameStatus('Saving nickname...', 'info');
    // }
    
    
    
    // stuff for admin access modes and stuff
    
    // socket.on('admin-login', data => {
    //     document.getElementById('advanced-controls').classList.remove('hidden');
    //     adminSettings = document.getElementById('admin-settings').classList.remove('hidden');
        
    // })
    
    
    // const accessModeSelect = document.getElementById('access-mode-select');
    
    // socket.on('mode-update', data => {
    
    //     // if(data === 'admin') {
    //     // adminSettings = document.getElementById('admin-settings').classList.remove('hidden');
    //     console.log('mode update', data);
    //     accessModeSelect.value = data;
    //     // }
    
    // });
    // accessModeSelect.addEventListener('change', (event) =>{
    //     console.log('mode change')
    //     socket.emit('change-access-mode', accessModeSelect.value)
    // })
    
    
    // if (accessModeSelect && accessModeStatus) {
    //     accessModeStatus.textContent = accessModeSelect.options[accessModeSelect.selectedIndex].text;
    //     accessModeSelect.addEventListener('change', (event) => {
    //         const selectedOption = event.target.options[event.target.selectedIndex];
    //         accessModeStatus.textContent = selectedOption ? selectedOption.text : '';
    //     });
    // }
    
    // <div id="room-controls" class="items-center content-center w-full justify-center gap-2">
    // <!-- controls for lights in room (on/off) -->
    // <button id="room-light-1-button" class="btn bg-yellow-500">
    //     <p class="text-xl">Room Light 1</p>
    //     <p>Turn the room lights on or off</p>
    //     <p class="bg-green-500 bg-red-500 rounded-xl" id="room-lights-status">Unknown</p>
    // </button>
    
    
    // create a button (^^) for each light sent from the server:
    
    const lightButtonContainer = document.getElementById('light-button-container');
    var old_states = [];
    var numberOfLights = 0;
    
    socket.on('light_states', states => {
        // console.log('light states', states);
        numberOfLights = states.length
        if (JSON.stringify(states) === JSON.stringify(old_states)) return; // Only update if states have changed
        old_states = JSON.parse(JSON.stringify(states)); // Create a deep copy of states
    
        if (!Array.isArray(states) || states.length === 0) return;
        lightButtonContainer.innerHTML = '';
        console.log('drawing buttons. old states: ', old_states);
    
        states.forEach((state, index) => {
            const button = document.createElement('button');
            button.id = `room-light-${index + 1}-button`;
            button.className = `rounded-md p-1 px-2 bg-yellow-500 bold text-xl`;
            button.innerHTML = 
            `<p class="text-xl">Room Light ${index + 1}</p>
            <p class="${state ? 'bg-green-500' : 'bg-red-500'} rounded-xl mt-1" id="room-lights-status">${state ? 'On' : 'Off'}</p>`;
            button.addEventListener('click', () => {
                socket.emit('light_switch', { index, state: !state });
            });
            lightButtonContainer.appendChild(button);
        });
    });
    
    
    const player = new PCMPlayer({
        encoding: '16bitInt',
        channels: 1,
        sampleRate: 16000,
        flushTime: 20
    });
    
    // Play an alert when the current user becomes the active driver.
    // const turnAlertAudio = new Audio('/turn_alert.mp3');
    // turnAlertAudio.preload = 'auto';
    // let lastAlertedTurnKey = null;
    
    let reloadSet = null;
    let reloadTimerInterval = null;
    function reloadTimer() {
        window.location.reload();
    }
    
    function hideOverlayAndClearReloadTimer() {
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.add('hidden');
        if (reloadTimerInterval) {
            clearInterval(reloadTimerInterval);
            reloadTimerInterval = null;
        }
    }
    
    socket.on('connect_error', (err) => {
        showToast(err, 'error', false)
        console.log('connect_error', err.message)
    
        // if(err.message === 'ADMIN_ENABLED') {
        //     console.log('showverlay')
        //     let loginOverlay = document.getElementById('overlay')
    
        //     loginOverlay.classList.remove('hidden');
        //     if (!reloadTimerInterval) {
        //         reloadTimerInterval = setInterval(reloadTimer, 60000);
        //     }
        // }
    
        if(err.message === 'LOCKDOWN_ENABLED') {
            console.log('showverlay lockdown')
            let loginOverlay = document.getElementById('overlay')
            loginOverlay.classList.remove('hidden');
            document.getElementById('overlay-top-caption').innerText = 'Lockdown Privacy mode is enabled. Only the owner can log in. This page reloads automatically every minute.'
            if (!reloadTimerInterval) {
                reloadTimerInterval = setInterval(reloadTimer, 60000);
            }
        }
    })
    
    
    socket.on('disconnect-reason', (reason) => {
        // if(reason === 'SWITCH_TO_ADMIN') {
        //     document.getElementById('overlay').classList.remove('hidden')
        //     if (!reloadTimerInterval) {
        //         reloadTimerInterval = setInterval(reloadTimer, 60000);
        //     }
        // }
    
        if(reason === 'SWITCH_TO_TURNS') {
            // console.log('disconnect, switch to turns')
            showToast('Switching to Turns mode. Reloading page.')
            window.location.reload();
        }
        
    
        if(reason === 'SWITCH_TO_LOCKDOWN') {
            console.log('showverlay lockdown')
            let loginOverlay = document.getElementById('overlay')
            loginOverlay.classList.remove('hidden');
            document.getElementById('overlay-top-caption').innerText = 'Lockdown Privacy mode is enabled.'
            if (!reloadTimerInterval) {
                reloadTimerInterval = setInterval(reloadTimer, 60000);
            }
        }
    })
    
    socket.on('connect', () => {
        console.log('Connected to server')
        clearInterval(reloadSet);
        selfId = socket.id;
        document.getElementById('connectstatus').innerText = 'Connected'
        document.getElementById('connectstatus').classList.remove('bg-red-500')
        document.getElementById('connectstatus').classList.add('bg-green-500')
    
        // sensorData()
        // startVideo()
        // stopAudio()
        // startAudio()
    
        // Find your image element
        // const cameraImg = document.getElementById('front-camera'); // or whatever your img id is
    
        // if (cameraImg) {
        //     // Add timestamp to force reload
        //     const currentSrc = cameraImg.src.split('?')[0]; // Remove existing params
        //     cameraImg.src = currentSrc + '?t=' + Date.now();
        // }
        // if (desiredNickname) {
        //     requestNicknameUpdate(desiredNickname);
        // }
    
        hideOverlayAndClearReloadTimer();
    });
    socket.on('disconnect', () => {
        console.log('Disconnected from server')
        selfId = null;
        currentNickname = '';
        document.getElementById('connectstatus').innerText = 'Disconnected'
        document.getElementById('connectstatus').classList.remove('bg-green-500')
        document.getElementById('connectstatus').classList.add('bg-red-500')
    });
    
    socket.on('nickname:update', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const { userId, nickname } = payload;
    
        if (userId !== socket.id) {
            return;
        }
    
        const sanitized = typeof nickname === 'string' ? nickname : '';
        const fallback = sanitized || 'User';
        const previousDesired = desiredNickname;
        const changedByServer = previousDesired && previousDesired !== sanitized;
        const defaultNickname = typeof userId === 'string' && userId.length >= 4 ? `User ${userId.slice(-4)}` : '';
        const isDefaultNickname = sanitized === defaultNickname;
    
        currentNickname = sanitized;
        desiredNickname = isDefaultNickname ? '' : sanitized;
    
        if (dom.nicknameInput) {
            dom.nicknameInput.value = sanitized;
        }
    
        if (isDefaultNickname || currentNickname.startsWith('User')) {
            localStorage.removeItem(NICKNAME_STORAGE_KEY);
        } else {
            localStorage.setItem(NICKNAME_STORAGE_KEY, sanitized);
        }
    
        if (!previousDesired && isDefaultNickname) {
            setNicknameStatus('');
            return;
        }
    
        const statusMessage = changedByServer
            ? `Nickname adjusted to ${fallback}.`
            : `Nickname set to ${fallback}.`;
    
        setNicknameStatus(statusMessage, 'success');
    });
    
    socket.on('system-stats', data => {
        dom.cpuUsage.textContent = `CPU: ${data.cpu}%`;
        dom.memoryUsage.textContent = `RAM: ${data.memory}%`;
    });
    
    // // key handler function
    // const pressedKeys = new Set();
    // function handleKeyEvent(event, isKeyDown) {
    //     const key = event.key.toLowerCase();
    //     if (['w', 'a', 's', 'd', 'shift', '\\'].includes(key)) {
    //         if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
    //         else if (!isKeyDown) pressedKeys.delete(key);
    //         else return;
    
    //         const speeds = keySpeedCalculator(pressedKeys);
    //         // console.log(`Left: ${speeds.leftSpeed}, Right: ${speeds.rightSpeed}`);
    //         socket.emit('Speedchange', speeds);
    //     }
    
    //     // key controls for side brush
    //     if (['o', 'l'].includes(key)) {
    //         if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
    //         else if (!isKeyDown) pressedKeys.delete(key);
    //         else return;
    
    //         if (pressedKeys.has('o')) speed = 127
    //         if (pressedKeys.has('l')) speed = -50
    //         if (!pressedKeys.has('o') && !pressedKeys.has('l')) speed = 0
    
    //         socket.emit('sideBrush', { speed: speed })
    
    //     } 
    
    //     //key controls for vacuum motor
    //     if (['i', 'k'].includes(key)) {
    //         if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
    //         else if (!isKeyDown) pressedKeys.delete(key);
    //         else return;
    
    //         if (pressedKeys.has('i')) speed = 127
    //         if (pressedKeys.has('k')) speed = 20
    //         if (!pressedKeys.has('i') && !pressedKeys.has('k')) speed = 0
    
    //         socket.emit('vacuumMotor', { speed: speed })
    
    //     }
    
    //     // key controls for brush motor
    //     if (['p', ';'].includes(key)) {
    //         if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
    //         else if (!isKeyDown) pressedKeys.delete(key);
    //         else return;
    //         if (pressedKeys.has('p')) speed = 127
    //         if (pressedKeys.has(';')) speed = -50
    //         if (!pressedKeys.has('p') && !pressedKeys.has(';')) speed = 0
    
    //         socket.emit('brushMotor', { speed: speed })
    //     }
    
    //     //control for all motors at once
    //     if (['.'].includes(key)) {
    //         if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
    //         else if (!isKeyDown) pressedKeys.delete(key);
    //         else return;
    //         if (pressedKeys.has('.')) speed = 127
    //         if (!pressedKeys.has('.')) speed = 0
    
    //         socket.emit('sideBrush', {speed: speed})
    //         socket.emit('vacuumMotor', {speed: speed})
    //         socket.emit('brushMotor', {speed: speed})
    //     }
    
    //     //press enter to start typing a message, then press enter again to send it
    //     // let inputFocused = false
    //     let sendButton = document.getElementById('sendMessageButton')
    //     let messageInput = document.getElementById('messageInput')
    //     if (['enter'].includes(key)) {
    //         if (isKeyDown && !pressedKeys.has(key)) pressedKeys.add(key);
    //         else if (!isKeyDown) pressedKeys.delete(key);
    //         else return;
    
    //         if (document.activeElement === messageInput && isKeyDown) {
    //             sendButton.click()
    //             if (messageInput.value === '') {
    //                 messageInput.blur()
    //             }
    //             messageInput.blur()
    //         } else if (document.activeElement !== messageInput && isKeyDown) {
    //             messageInput.focus()
    
    //         }
    //     }
    // }
    
    // document.addEventListener('keydown', e => handleKeyEvent(e, true));
    // document.addEventListener('keyup', e => handleKeyEvent(e, false));
    
    // function keySpeedCalculator(keys) {
    //     const baseSpeed = 100;
    //     const fast = 2.5, slow = 0.5;
    //     let left = 0, right = 0, mult = 1;
    //     if (keys.has('\\')) mult = fast;
    //     else if (keys.has('shift')) mult = slow;
    //     if (keys.has('w')) left += baseSpeed, right += baseSpeed;
    //     if (keys.has('s')) left -= baseSpeed, right -= baseSpeed;
    //     if (keys.has('a')) left -= baseSpeed, right += baseSpeed;
    //     if (keys.has('d')) left += baseSpeed, right -= baseSpeed;
    //     return { leftSpeed: left * mult, rightSpeed: right * mult };
    // }
    
    // function dockNow() { socket.emit('Docking', { action: 'dock' }); }
    // function reconnectRoomba() { socket.emit('Docking', { action: 'reconnect' }); }
    // function sensorData() { socket.emit('requestSensorData'); }
    // function startVideo() { socket.emit('startVideo'); }
    // function stopVideo() { socket.emit('stopVideo'); }
    // function startAudio() { socket.emit('startAudio'); }
    // function stopAudio() { socket.emit('stopAudio'); }
    // function sideBrush(state) { socket.emit('sideBrush', { action:state }); }
    
    // function easyStart() { 
    //     socket.emit('easyStart');
    //     for (let i = 0; i < numberOfLights; i++) {
    //         socket.emit('light_switch', { index: i, state: true });
    //     }
    // }
    
    // function easyDock() { socket.emit('easyDock'); }
    
    const dotblinker = document.getElementById('blinker');
    dotblinker.classList.toggle('bg-red-500')
    
    // Track object URLs so they can be revoked and avoid memory leaks
    // let frontVideoUrl = null;
    // let rearVideoUrl = null;
    let roomCameraUrl = null;
    
    // socket.on('videoFrame:frontCamera', data => {
    //     const blob = new Blob([data], { type: 'image/jpeg' });
    //     if (frontVideoUrl) URL.revokeObjectURL(frontVideoUrl);
    //     frontVideoUrl = URL.createObjectURL(blob);
    //     document.getElementById('video').src = frontVideoUrl;
    
    //     dotblinker.classList.toggle('bg-red-500')
    //     dotblinker.classList.toggle('bg-green-500')
    // });
    
    
    // socket.on('videoFrame:rearCamera', data => {
    //     const blob = new Blob([data], { type: 'image/jpeg' });
    //     if (rearVideoUrl) URL.revokeObjectURL(rearVideoUrl);
    //     rearVideoUrl = URL.createObjectURL(blob);
    //     document.getElementById('rearvideo').src = rearVideoUrl;
    // })
    
    roomBlinker = document.getElementById('room-blinker')
    socket.on('room-camera-frame', data => {
        const blob = new Blob([data], {type: 'image/lpeg'});
        if(roomCameraUrl) URL.revokeObjectURL(roomCameraUrl);
        roomCameraUrl = URL.createObjectURL(blob);
        document.getElementById('room-camera').src = roomCameraUrl;
    
        roomBlinker.classList.toggle('bg-red-500');
        roomBlinker.classList.toggle('bg-green-500');
        // console.log('room camera frame')
    })
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const videoWs = new WebSocket(`${protocol}//${window.location.host}/video-stream`);

    const videoElement = document.getElementById('video');
    let frontVideoUrl = null;

    videoWs.onopen = () => {
        console.log('Video WebSocket connected');
    };

    videoWs.onmessage = (event) => {
        // Receive raw JPEG frame data
        const blob = new Blob([event.data], { type: 'image/jpeg' });
        
        // Revoke previous URL to prevent memory leak
        if (frontVideoUrl) {
            URL.revokeObjectURL(frontVideoUrl);
        }
        
        frontVideoUrl = URL.createObjectURL(blob);
        videoElement.src = frontVideoUrl;
    };
    videoWs.onerror = (error) => {
        console.error('Video WebSocket error:', error);
    };

    videoWs.onclose = () => {
        console.log('Video WebSocket disconnected');
        // Reconnect after 3 seconds
        // setTimeout(() => {
        //     location.reload();
        // }, 3000);
    };

    
    // socket.on('videoFrame', () => {
    //     dotblinker.classList.toggle('bg-red-500')
    //     dotblinker.classList.toggle('bg-green-500')
    // })
    
    socket.on('audio', chunk => {
        try {
            player.feed(new Int16Array(chunk));
            player.flush();
        } catch (err) {
            console.error('Error processing audio:', err);
        }
    });
    
    sensorblinker = document.getElementById('sensorblinker');
    sensorblinker.classList.toggle('bg-pink-400')
    
    
    var MAX_VALUE = 300
    var MAX_VALUE_WCURRENT = 800
    var MAX_VALUE_CLIFF = 2700
    socket.on('SensorData', data => {
        const chargeStatusIndex = typeof data.chargeStatus === 'number' ? data.chargeStatus : 0;
        const chargeStatus = ['Not Charging', 'Reconditioning Charging', 'Full Charging', 'Trickle Charging', 'Waiting', 'Charging Error'][chargeStatusIndex] || 'Unknown';
        const chargingSources = data.chargingSources === 2 ? 'Docked' : 'None';
        const oiMode = data.oiMode === 2 ? 'Passive' : (data.oiMode === 4 ? 'Full' : 'Safe');
    
        document.getElementById('oi-mode').innerText = `Mode: ${oiMode}`;
        document.getElementById('dock-status').innerText = `Dock: ${chargingSources}`;
        document.getElementById('charge-status').innerText = `Charging: ${chargeStatus}`;
        document.getElementById('battery-usage').innerText = `Charge: ${data.batteryCharge} / ${data.batteryCapacity}`;
        const voltage = typeof data.batteryVoltage === 'number' ? data.batteryVoltage : 0;
        document.getElementById('battery-voltage').innerText = `Voltage: ${voltage / 1000}V`;
        const batteryTemp = Number.isFinite(data.batteryTemperature) ? data.batteryTemperature : null;
        document.getElementById('battery-temperature').innerText = batteryTemp !== null ? `Temp: ${batteryTemp}°C` : 'Temp: N/A';
        document.getElementById('brush-current').innerText = `Side Brush: ${data.brushCurrent}mA`;
        document.getElementById('battery-current').innerText = `Current: ${data.batteryCurrent}mA`;
        document.getElementById('main-brush-current').innerText = `Main Brush: ${data.mainBrushCurrent}mA`;
        document.getElementById('dirt-detect').innerText = `Dirt Detect: ${data.dirtDetect}`;
    
        updateChargeAlertOverlay(data.chargeAlert);
    
        const names = {
            leftWheel: 'Left Wheel',
            rightWheel: 'Right Wheel',
            mainBrush: 'Main Brush',
            sideBrush: 'Side Brush'
        };
        const active = Object.entries(data.overcurrents || {})
            .filter(([, state]) => state === 'ON')
            .map(([key]) => names[key]);
    
        if (active.length) {
            dom.overcurrentWarning.textContent = `OVERCURRENT\n${active.join('\n')}`;
            dom.overcurrentWarning.classList.remove('hidden');
            dom.overcurrentStatus.textContent = `Overcurrent: ${active.join(', ')}`;
        } else {
            dom.overcurrentWarning.classList.add('hidden');
            dom.overcurrentStatus.textContent = 'Overcurrent: none';
        }
    
        updateBumpSensors(data.bumpSensors);
    
        // console.log(`motor currents: Left: ${data.leftCurrent}mA, Right: ${data.rightCurrent}mA`);
    
        // console.log('Wall signal:', data.wallSignal);
        // dom.wallSignal.style.width = `${(data.wallSignal / MAX_VALUE) * 100}%`;
        dom.leftCurrentBar.style.height = `${(data.leftCurrent / MAX_VALUE_WCURRENT) * 100}%`;
        dom.rightCurrentBar.style.height = `${(data.rightCurrent / MAX_VALUE_WCURRENT) * 100}%`;
    
        dom.cliffSensors.L.style.height=`${(data.cliffSensors[0] / MAX_VALUE_CLIFF) * 100}%`
        dom.cliffSensors.FL.style.height=`${(data.cliffSensors[1] / MAX_VALUE_CLIFF) * 100}%`
        dom.cliffSensors.FR.style.height=`${(data.cliffSensors[2] / MAX_VALUE_CLIFF) * 100}%`
        dom.cliffSensors.R.style.height=`${(data.cliffSensors[3] / MAX_VALUE_CLIFF) * 100}%`
    
    
        if(oiMode === 'Full') {
            dom.startButtonMessage.innerText = 'Ready to Drive!';
            dom.startButtonMessage.classList.remove('bg-red-500');
            dom.startButtonMessage.classList.add('bg-green-500');
        } else {
            dom.startButtonMessage.innerText = 'Not in Driving Mode!';
            dom.startButtonMessage.classList.remove('bg-green-500');
            dom.startButtonMessage.classList.add('bg-red-500');
        }
    
        if(chargingSources === 'Docked') {
            dom.dockButtonMessage.innerText = 'Docked!';
            dom.dockButtonMessage.classList.remove('bg-red-500');
            dom.dockButtonMessage.classList.add('bg-green-500');
            if(chargeStatus === 'Not Charging') {
                dom.dockButtonChargingMessage.innerText = 'Not Charging!';
                dom.dockButtonChargingMessage.classList.remove('bg-green-500');
                dom.dockButtonChargingMessage.classList.add('bg-red-500');
            } else {
                dom.dockButtonChargingMessage.innerText = chargeStatus;
                dom.dockButtonChargingMessage.classList.remove('bg-red-500');
                dom.dockButtonChargingMessage.classList.add('bg-green-500');
            }
        } else {
            dom.dockButtonMessage.innerText = 'Not Docked!';
            dom.dockButtonMessage.classList.remove('bg-green-500');
            dom.dockButtonMessage.classList.add('bg-red-500');
        }
    
        sensorblinker.classList.toggle('bg-pink-400')
        sensorblinker.classList.toggle('bg-black')
    
        if(data.bumpLeft) {
            // dom.bumpLeft.innerText = 'Bump Left: ON';
            dom.bumpLeft.classList.remove('bg-black');
            dom.bumpLeft.classList.add('bg-yellow-500');
        } else {
            // dom.bumpLeft.innerText = 'Bump Left: OFF';
            dom.bumpLeft.classList.remove('bg-yellow-500');
            dom.bumpLeft.classList.add('bg-black');
        }
    
        if(data.bumpRight) {
            // dom.bumpRight.innerText = 'Bump Right: ON';
            dom.bumpRight.classList.remove('bg-black');
            dom.bumpRight.classList.add('bg-yellow-500');
        } else {
            // dom.bumpRight.innerText = 'Bump Right: OFF';
            dom.bumpRight.classList.remove('bg-yellow-500');
            dom.bumpRight.classList.add('bg-black');
        }
    
        if(data.wheelDropLeft) {
            // dom.dropLeft.innerText = 'Drop Left: ON';
            dom.dropLeft.classList.remove('bg-black');
            dom.dropLeft.classList.add('bg-yellow-500');
        } else {
            // dom.dropLeft.innerText = 'Drop Left: OFF';
            dom.dropLeft.classList.remove('bg-yellow-500');
            dom.dropLeft.classList.add('bg-black');
        }
    
        if(data.wheelDropRight) {
            // dom.dropRight.innerText = 'Drop Right: ON';
            dom.dropRight.classList.remove('bg-black');
            dom.dropRight.classList.add('bg-yellow-500');
        } else {
            // dom.dropRight.innerText = 'Drop Right: OFF';
            dom.dropRight.classList.remove('bg-yellow-500');
            dom.dropRight.classList.add('bg-black');
        }
    
    
    
    
    });
    
    
    
    // Mapping of sensor index to DOM ID (same order as data.bumpSensors)
    const bumpKeys = ['L', 'FL', 'CL', 'CR', 'FR', 'R'];
    const bumpElements = bumpKeys.reduce((acc, key) => {
    acc[key] = document.getElementById(`lightbump-${key}`);
    return acc;
    }, {});
    
    // Range-based function to determine max value for scaling
    function getMaxForRange(value) {
    if (value < 100) return 100;
    if (value < 500) return 500;
    if (value < 1000) return 1000;
    if (value < 1500) return 1500;
    return 2000;
    }
    
    // Update bump sensor visuals based on their values
    function updateBumpSensors(bumpValues) {
    bumpKeys.forEach((key, index) => {
        const value = bumpValues[index];
        const el = bumpElements[key];
    
        // Use threshold-based scaling
        const max = getMaxForRange(value);
        const widthPercent = (value / max) * 100;
        const newColor = `hsl(${max / 2}, 100%, 50%)`;
    
        // Only update if the width would significantly change
        if (Math.abs(parseFloat(el.style.width || 0) - widthPercent) > 1) {
        el.style.width = `${widthPercent}%`;
        el.style.backgroundColor = newColor;
        }
    });
    }
    
    function appendChatMessage(payload) {
        if (!dom.chatMessagesCard || !dom.chatMessagesList) return;
    
        let messageText = '';
        let nicknameLabel = '';
        let timestamp = Date.now();
        let isSystem = false;
    
        if (typeof payload === 'string') {
            messageText = payload.trim();
        } else if (payload && typeof payload === 'object') {
            if (typeof payload.message === 'string') {
                messageText = payload.message.trim();
            }
            if (typeof payload.nickname === 'string') {
                nicknameLabel = payload.nickname.trim();
            }
            if (typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)) {
                timestamp = payload.timestamp;
            }
            isSystem = Boolean(payload.system);
        } else {
            return;
        }
    
        if (!messageText) return;
    
        dom.chatMessagesCard.classList.remove('hidden');
    
        const item = document.createElement('div');
        item.className = 'bg-gray-700 rounded-xl p-2 break-words';
        if (isSystem) {
            item.classList.add('border', 'border-purple-400');
        }
    
        const displayTime = new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const label = nicknameLabel || (isSystem ? 'System' : '');
        const prefix = label ? `${label}: ` : '';
        item.textContent = `[${displayTime}] ${prefix}${messageText}`;
    
        dom.chatMessagesList.appendChild(item);
    
        while (dom.chatMessagesList.childElementCount > MAX_CHAT_MESSAGES) {
            dom.chatMessagesList.removeChild(dom.chatMessagesList.firstChild);
        }
    
        dom.chatMessagesList.scrollTop = dom.chatMessagesList.scrollHeight;
    }
    
    
    
    socket.on('message', data => {
        document.getElementById('message').innerText = data;
        showToast(data, 'info')
    });
    
    socket.on('alert', data => {
        document.getElementById('message').innerText = data;
        showToast(data, 'error', false)
    });
    
    socket.on('warning', data => {
        showToast(data, 'warning', false)
    })
    
    socket.on('userMessageRe', message => {
        appendChatMessage(message);
    });
    
    socket.on('ffmpeg', data => {
        document.getElementById('ffmpeg').innerText = data;
    });
    
    socket.on('ollamaEnabled', data => {
        console.log('ollama enabled:', data);
        document.getElementById('ollama-panel').classList.remove('hidden');
    })
    
    
    
    const ollamaText = document.getElementById('ollama-response-text');
    
    socket.on('ollamaStreamChunk', data => {
        console.log('ollama stream chunk:', data);
        ollamaText.innerText += data;
        // showToast(data, 'info', false)
        ollamaText.scrollTop = ollamaText.scrollHeight; // Scroll to bottom
    });
    
    const ollamaStatus = document.getElementById('ollama-status');
    const ollamaSpinner = document.getElementById('ai-spinner');
    
    socket.on('controlLoopIteration', iterationInfo => {
        if (iterationInfo.status === 'started') {
            ollamaText.innerText = ''
            ollamaStatus.innerText = `Processing iteration ${iterationInfo.iterationCount}`;
            ollamaStatus.classList.remove('bg-red-500');
            ollamaStatus.classList.add('bg-blue-500');
            ollamaSpinner.classList.remove('hidden');
        } else if (iterationInfo.status === 'completed') {
            ollamaStatus.innerText = `Iteration ${iterationInfo.iterationCount} completed`;
            ollamaStatus.classList.remove('bg-blue-500');
            ollamaStatus.classList.add('bg-red-500');
            ollamaSpinner.classList.add('hidden');
        }
    });
    
    
    socket.on('aiModeEnabled', data => {
        console.log('AI mode enabled:', data);
        if(data){
            document.getElementById('ai-mode-status').innerText = 'Currently Enabled';
            document.getElementById('ai-mode-status').classList.remove('bg-red-500');
            document.getElementById('ai-mode-status').classList.add('bg-green-500');
        } else {
            document.getElementById('ai-mode-status').innerText = 'Currently Disabled';
            document.getElementById('ai-mode-status').classList.remove('bg-green-500');
            document.getElementById('ai-mode-status').classList.add('bg-red-500');
    
            ollamaStatus.innerText = 'Not Processing';
            ollamaStatus.classList.remove('bg-blue-500');
            ollamaStatus.classList.add('bg-red-500');
    
            ollamaSpinner.classList.add('hidden');
        }
    })
    
    socket.on('newGoal', goalText => {
        console.log('New goal received:', goalText);
        document.getElementById('goal-text').innerText = `Current Goal: ${goalText}`;
        // showToast(`New goal: ${goalText}`, 'info', false);
    });
    
    // socket.on('usercount', count => {
    //     dom.userCount.innerText = `${count} Online`;
    // })
    
    // const spectateModeCheckbox = document.getElementById('spectate-mode-checkbox')
    
    // spectateModeCheckbox.addEventListener('change', (event) => {
    //     const isChecked = event.target.checked;
    //     socket.emit('set-spectate-mode', isChecked);
    // });
    
    socket.on('turns:update', data => {
        if (!dom.turnQueueCard) return;
    
        const resetTurnAppearance = () => {
            dom.turnQueueCard.classList.remove('bg-green-600', 'bg-yellow-600', 'shadow-lg');
            dom.turnQueueCard.classList.add('bg-gray-700');
            dom.turnQueueYourStatus.classList.remove('bg-green-500', 'bg-yellow-500', 'text-black', 'font-semibold');
            dom.turnQueueYourStatus.classList.add('bg-gray-700');
        };
    
        resetTurnAppearance();
    
        if (!data || !data.isTurnModeActive) {
            lastAlertedTurnKey = null;
            dom.turnQueueCard.classList.add('hidden');
            dom.turnQueueYourStatus.textContent = 'Turns mode not active.';
            dom.turnQueueCountdown.textContent = '';
            dom.turnQueueList.innerHTML = '';
            return;
        }
    
        dom.turnQueueCard.classList.remove('hidden');
    
        const queue = Array.isArray(data.queue) ? data.queue : [];
        const turnDuration = data.turnDurationMs || 0;
        const serverNow = data.serverTimestamp || Date.now();
        const remainingCurrent = data.turnExpiresAt ? Math.max(0, data.turnExpiresAt - serverNow) : 0;
        const idleSkipExpiresAt = (typeof data.idleSkipExpiresAt === 'number' && Number.isFinite(data.idleSkipExpiresAt))
            ? data.idleSkipExpiresAt
            : null;
        const idleSkipRemaining = idleSkipExpiresAt !== null ? Math.max(0, idleSkipExpiresAt - serverNow) : null;
        const idleSkipActive = Boolean(idleSkipExpiresAt !== null && idleSkipExpiresAt > serverNow);
        const chargingPauseActive = Boolean(data.chargingPause);
        const chargingPauseReason = data.chargingPauseReason || '';
        const turnIdentifier = (() => {
            if (typeof data.turnExpiresAt === 'number' && Number.isFinite(data.turnExpiresAt)) {
                return `${data.turnExpiresAt}:${data.currentDriverId || ''}`;
            }
            return data.currentDriverId ? `id:${data.currentDriverId}` : null;
        })();
    
        dom.turnQueueList.innerHTML = '';
    
        if (queue.length === 0) {
            const emptyRow = document.createElement('div');
            emptyRow.className = 'text-sm bg-gray-700 rounded-xl p-2 text-center';
            emptyRow.textContent = 'No drivers are waiting right now.';
            dom.turnQueueList.appendChild(emptyRow);
        } else {
            queue.forEach((entry, idx) => {
                const row = document.createElement('div');
                row.className = 'p-2 rounded-xl bg-gray-700 flex justify-between text-sm';
    
                const baseName = (entry && typeof entry.nickname === 'string' && entry.nickname.trim())
                    ? entry.nickname.trim()
                    : (entry.id && entry.id.length > 6 ? `User ${entry.id.slice(-6)}` : (entry.id || 'User'));
                const isSelf = selfId && entry.id === selfId;
                const label = isSelf ? `You (${baseName})` : baseName;
    
                const positionSpan = document.createElement('span');
                positionSpan.textContent = `${idx + 1}. ${label}`;
    
                const statusSpan = document.createElement('span');
                if (chargingPauseActive && idx === 0) {
                    statusSpan.textContent = 'Paused';
                } else if (entry.isCurrent && idleSkipActive) {
                    statusSpan.textContent = 'Idle (skipping soon)';
                } else {
                    statusSpan.textContent = entry.isCurrent ? 'Driving' : '';
                }

                row.appendChild(positionSpan);
                row.appendChild(statusSpan);
                dom.turnQueueList.appendChild(row);
            });
        }
    
        let yourStatus = '';
        let countdown = '';
        let position = -1;
    
        if (!selfId) {
            yourStatus = queue.length ? 'Connect to claim a spot in the queue.' : 'Turns mode active. Waiting for drivers to join.';
        } else if (queue.length === 0) {
            yourStatus = 'Turns mode active. Waiting for drivers to join.';
        } else {
            position = queue.findIndex((entry) => entry.id === selfId);
            if (position === -1) {
                yourStatus = queue.length ? 'Admins can drive without waiting.' : 'Turns mode active. Waiting for drivers to join.';
            } else if (position === 0) {
                yourStatus = 'It is your turn to drive!';
                if (!chargingPauseActive && data.mode === 'turns' && turnIdentifier && lastAlertedTurnKey !== turnIdentifier) {
                    lastAlertedTurnKey = turnIdentifier;
                    try {
                        turnAlertAudio.currentTime = 0;
                        const playPromise = turnAlertAudio.play();
                        if (playPromise && typeof playPromise.catch === 'function') {
                            playPromise.catch((err) => console.debug('Unable to play turn alert sound:', err));
                        }
                    } catch (err) {
                        console.debug('Unable to play turn alert sound:', err);
                    }
                }
                if (!chargingPauseActive && idleSkipActive) {
                    const idleCountdownSeconds = Math.max(1, Math.ceil(idleSkipRemaining / 1000));
                    const idleCountdownText = `${idleCountdownSeconds}s`;
                    const turnCountdownText = remainingCurrent ? ` Total turn time left: ${formatDuration(remainingCurrent)}.` : '';
                    yourStatus = 'It is your turn—move now to keep it!';
                    countdown = `Move the rover or your turn skips in ${idleCountdownText}.${turnCountdownText}`;
                    dom.turnQueueCard.classList.remove('bg-gray-700');
                    dom.turnQueueCard.classList.add('bg-yellow-600', 'shadow-lg');
                    dom.turnQueueYourStatus.classList.remove('bg-gray-700');
                    dom.turnQueueYourStatus.classList.add('bg-yellow-500', 'text-black', 'font-semibold');
                } else {
                    countdown = remainingCurrent ? `Time remaining in your turn: ${formatDuration(remainingCurrent)}.` : '';
                }
                if (!chargingPauseActive) {
                    dom.turnQueueCard.classList.remove('bg-gray-700');
                    dom.turnQueueYourStatus.classList.remove('bg-gray-700');
                    if (!idleSkipActive) {
                        dom.turnQueueCard.classList.add('bg-green-600', 'shadow-lg');
                        dom.turnQueueYourStatus.classList.add('bg-green-500', 'text-black', 'font-semibold');
                    }
                }
            } else {
                yourStatus = `You are ${position + 1} of ${queue.length} in line.`;
                if (turnDuration && data.turnExpiresAt) {
                    const waitMs = remainingCurrent + Math.max(0, position - 1) * turnDuration;
                    countdown = `Estimated time until your turn: ${formatDuration(waitMs)}.`;
                } else {
                    countdown = 'Estimated time until your turn: calculating...';
                }
            }
        }
    
        if (chargingPauseActive) {
            dom.turnQueueCard.classList.remove('bg-gray-700');
            dom.turnQueueCard.classList.add('bg-yellow-600');
            dom.turnQueueYourStatus.classList.remove('bg-gray-700');
            dom.turnQueueYourStatus.classList.add('bg-yellow-500', 'text-black', 'font-semibold');
    
            const reasonLabel = (() => {
                switch (chargingPauseReason) {
                    case 'battery-charging':
                        return 'Battery charging';
                    case 'battery-low':
                        return 'Battery low';
                    default:
                        return 'Turns paused';
                }
            })();
    
            const resumeInstruction = chargingPauseReason === 'battery-low'
                ? 'Turns resume automatically once the battery recovers.'
                : 'Turns resume automatically after charging completes.';
    
            if (position === 0) {
                yourStatus = chargingPauseReason === 'battery-low'
                    ? 'Battery low. Please dock the rover. You will be first once turns resume.'
                    : `${reasonLabel}. You will be first once turns resume.`;
            } else if (position > 0) {
                yourStatus = `${reasonLabel}. You remain ${position + 1} in line.`;
            } else {
                yourStatus = chargingPauseReason === 'battery-low'
                    ? 'Battery low. Please dock the rover to keep the queue moving.'
                    : `${reasonLabel}. Please keep the rover docked until it finishes.`;
            }
            countdown = resumeInstruction;
        }
    
        dom.turnQueueYourStatus.textContent = yourStatus;
        dom.turnQueueCountdown.textContent = countdown;
    });
    
    socket.on('logs', logs => {
        // console.log('Received logs:', logs);
        const logContainer = document.getElementById('log-container');
        logContainer.innerHTML = ''; // Clear previous logs
        if (logs.length === 0) {
            logContainer.innerHTML = '<p class="text-xs">No logs available.</p>';
        }
        logs.forEach(log => {
            const logItem = document.createElement('p');
            logItem.className = 'text-xs font-mono';
            logItem.innerText = log;
            logContainer.appendChild(logItem);
        });
        logContainer.scrollTop = logContainer.scrollHeight; // Scroll to bottom
    })
    
    socket.on('ollamaParamsRelay', params => {
        console.log('Received ollama params:', params);
        document.getElementById('ollama-temperature').value = params.temperature;
        document.getElementById('ollama-top_k').value = params.top_k;
        document.getElementById('ollama-top_p').value = params.top_p;
        document.getElementById('ollama-min_k').value = params.min_k;
    })
    
    // // Joystick control
    // const joystick = nipplejs.create({
    //     zone: document.getElementById('joystick'),
    //     mode: 'dynamic',
    //     // position: { left: '50%', top: '50%' },
    //     color: 'pink',
    //     size: '200'
    // });
    
    // wheel speed calculations
    // const MAX_SPEED = 200
    // joystick.on('move', function (evt, data) {
    //     if (!data || !data.distance || !data.angle) return;
    //     let leftSpeed = data.vector.y * MAX_SPEED + data.vector.x * MAX_SPEED;
    //     let rightSpeed = data.vector.y * MAX_SPEED - data.vector.x * MAX_SPEED;
    
    //     leftSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, leftSpeed));
    //     rightSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, rightSpeed));
    
    //     leftSpeed = Math.round(leftSpeed);
    //     rightSpeed = Math.round(rightSpeed);
    
    //     // console.log(data.vector.x, data.vector.y);
    //     // console.log(`Left: ${leftSpeed}, Right: ${rightSpeed}`);
    //     socket.emit('Speedchange', { leftSpeed, rightSpeed });
    // });
    
    // joystick.on('end', function () {
    //     socket.emit('Speedchange', { leftSpeed: 0, rightSpeed: 0 });
    // });
    
    // function formatDuration(ms) {
    //     if (!Number.isFinite(ms)) return '0s';
    
    //     const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    //     const minutes = Math.floor(totalSeconds / 60);
    //     const seconds = totalSeconds % 60;
    
    //     if (minutes > 0) {
    //         return `${minutes}m ${seconds}s`;
    //     }
    
    //     return `${seconds}s`;
    // }
    
    // function rebootServer() {
    //     const confirm = document.getElementById('rebootconfirm').checked;
    //     if (confirm) {
    //         socket.emit('rebootServer');
    //         document.getElementById('rebootconfirm').checked = false;
    //         alert("Rebooting Roomba's server. This will take a few minutes.");
    //     } else {
    //         alert("Please check the confirmation box to reboot the server.");
    //     }
    // }
    
    // Stream your webcam stuff (WIP)
    // function sendFrame() {
    //     const video = document.getElementById('localcam');
    //     const canvas = document.createElement('canvas');
    //     const ctx = canvas.getContext('2d');
    
    //     canvas.width = video.videoWidth;
    //     canvas.height = video.videoHeight;
    //     ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    //     const data = canvas.toDataURL('image/jpeg', 0.5);
    //     socket.emit('userWebcam', data);
    // }
    
    
    
    // async function startWebcam() {
    //     const video = document.getElementById('localcam');
    
    //     const stream = await navigator.mediaDevices.getUserMedia({
    //         video: true,
    //         audio: false
    //     });
    //     video.srcObject = stream;
    //     const canvas = document.createElement('canvas');
    //     const ctx = canvas.getContext('2d');
    //     setInterval(() => {
    //         canvas.width = video.videoWidth;
    //         canvas.height = video.videoHeight;
    //         ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    //         const data = canvas.toDataURL('image/jpeg', 0.5);
    //         socket.emit('userWebcam', data);
    //         // console.log(data);
    //     }, 1000 / 2); 
    // }
    
    // function stopWebcam() {
    //     console.log('stopping webcam')
    // }
    
    
    
    // send a message to the roomba screen
    // if (dom.nicknameSaveButton) {
    //     dom.nicknameSaveButton.addEventListener('click', () => {
    //         if (!dom.nicknameInput) return;
    //         requestNicknameUpdate(dom.nicknameInput.value);
    //     });
    // }
    
    // if (dom.nicknameInput) {
    //     dom.nicknameInput.addEventListener('keydown', (event) => {
    //         if (event.key === 'Enter') {
    //             event.preventDefault();
    //             requestNicknameUpdate(dom.nicknameInput.value);
    //         }
    //     });
    
    //     dom.nicknameInput.addEventListener('input', () => {
    //         setNicknameStatus('');
    //     });
    // }
    
    // document.getElementById('sendMessageButton').addEventListener('click', () => {
    //     const inputEl = document.getElementById('messageInput');
    //     if (!inputEl) return;
    //     const message = inputEl.value.trim();
    //     if (!message) {
    //         inputEl.value = '';
    //         return;
    //     }
    
    //     socket.emit('userMessage', { message, beep: document.getElementById('beepcheck').checked });
    //     inputEl.value = '';
    // });
    
    // send typing status to roomba screen
    // document.getElementById('messageInput').addEventListener('input', () => {
    //     const message = document.getElementById('messageInput').value
    //     socket.emit('userTyping', { message, beep: document.getElementById('beepcheck').checked });
    // });
    
    // // handle events from aux motor buttons on the joystick card
    // document.getElementById('brushForwardButton').addEventListener('pointerdown', () => {
    //     socket.emit('sideBrush', { speed: 127 });
    // })
    // document.getElementById('brushForwardButton').addEventListener('pointerup', () => {
    //     socket.emit('sideBrush', { speed: 0 });
    // })
    // document.getElementById('brushReverseButton').addEventListener('pointerdown', () => {
    //     socket.emit('sideBrush', { speed: -127 });
    // })
    // document.getElementById('brushReverseButton').addEventListener('pointerup', () => {
    //     socket.emit('sideBrush', { speed: 0 });
    // })
    // document.getElementById('vacuumMotorButton').addEventListener('pointerdown', () => {
    //     socket.emit('vacuumMotor', { speed: 127 });
    // })
    // document.getElementById('vacuumMotorButton').addEventListener('pointerup', () => {
    //     socket.emit('vacuumMotor', { speed: 0 });
    // })
    
    // document.getElementById('ai-start-button').addEventListener('click', () => {
    //     socket.emit('enableAIMode', { enabled: true });
    // });
    
    // document.getElementById('ai-stop-button').addEventListener('click', () => {
    //     socket.emit('enableAIMode', { enabled: false });
    // });
    
    // document.getElementById('goal-input-submit').addEventListener('click', () => {
    //     const goalInput = document.getElementById('goal-input');
    //     const goalText = goalInput.value.trim();
    //     if (goalText) {
    //         socket.emit('setGoal', { goal: goalText });
    //         goalInput.value = ''; // Clear input after sending
    //     }
    // });
    
    // document.getElementById('user-counter').addEventListener('click', () => {
    //     const userList = document.getElementById('user-list');
    //     userList.classList.toggle('hidden');
    
    //     //save the stat to a cookie
    //     const isHidden = userList.classList.contains('hidden');
    //     document.cookie = `userListHidden=${isHidden}; path=/; max-age=31536000`; // 1 year
    // });
    
    // // const roomCamera = document.getElementById('room-camera-container')
    
    // document.getElementById('hide-controls-button').addEventListener('click', () => {
    //     const controlsGuide = document.getElementById('controls-guide-container');
    //     controlsGuide.classList.toggle('hidden');
    //     // roomCamera.classList.toggle('hidden');
    
    
    //     //save this state with a cookie
    //     const isHidden = controlsGuide.classList.contains('hidden');
    //     document.cookie = `controlsGuideHidden=${isHidden}; path=/; max-age=31536000`; // 1 year
    // });
    
    // document.getElementById('hide-room-controls-button').addEventListener('click', () => {
    //     const roomControls = document.getElementById('room-controls');
    //     roomControls.classList.toggle('hidden')
    
    //     const isHidden = roomControls.classList.contains('hidden');
    //     document.cookie = `roomControlsHidden=${isHidden}; path=/; max-age=31536000`; // 1 year
    // });
    
    // //read the cookie to set the initial state
    // document.addEventListener('DOMContentLoaded', () => {
    //     const controlsGuide = document.getElementById('controls-guide-container');
    //     const cookies = document.cookie.split('; ');
    //     const hiddenCookie = cookies.find(row => row.startsWith('controlsGuideHidden='));
    //     if (hiddenCookie) {
    //         const isHidden = hiddenCookie.split('=')[1] === 'true';
    //         if (isHidden) {
    //             controlsGuide.classList.add('hidden');
    //             // roomCamera.classList.remove('hidden')
    //         } else {
    //             controlsGuide.classList.remove('hidden');
    //             // roomCamera.classList.add('hidden');
    //         }
    //     }
    
    //     // read cookie for user list popup aswell
    //     const userList = document.getElementById('user-list');
    //     const userListCookie = cookies.find(row => row.startsWith('userListHidden='));
    //     if (userListCookie) {
    //         const isHidden = userListCookie.split('=')[1] === 'true';
    //         if (isHidden) {
    //             userList.classList.add('hidden');
    //         } else {
    //             userList.classList.remove('hidden');
    //         }
    //     }
    
    //     // read cookie for ollama controls
    //     // const ollamaPanel = document.getElementById('ollama-panel');
    //     const ollamaPanelCookie = cookies.find(row => row.startsWith('ollamaPanelHidden='));
    //     if (ollamaPanelCookie) {
    //         const isHidden = ollamaPanelCookie.split('=')[1] === 'true';
    //         if (isHidden) {
    //             // ollamaPanel.classList.add('hidden');
    //             document.getElementById('ollama-advanced-controls').classList.add('hidden');
    //         } else {
    //             // ollamaPanel.classList.remove('hidden');
    //             document.getElementById('ollama-advanced-controls').classList.remove('hidden');
    //         }
    //     }
    
    //     // read cookie for room controls
    //     const roomControlsCookie = cookies.find(row => row.startsWith('roomControlsHidden='));
    //     if (roomControlsCookie) {
    //         const isHidden = roomControlsCookie.split('=')[1] === 'true';
    //         if (isHidden) {
    //             document.getElementById('room-controls').classList.add('hidden');
    //         } else {
    //             document.getElementById('room-controls').classList.remove('hidden');
    //         }
    //     }
    // });
    
    // document.getElementById('request-logs').addEventListener('click', () => {
    //     socket.emit('requestLogs');
    // });
    
    // document.getElementById('reset-logs').addEventListener('click', () => {
    //     socket.emit('resetLogs');
    //     const logContainer = document.getElementById('log-container');
    //     logContainer.innerHTML = '<p class="text-sm text-gray-300">Logs cleared.</p>';
    // });
    
    // document.getElementById('hide-ollama-button').addEventListener('click', () => {
    //     const advancedControls = document.getElementById('ollama-advanced-controls');
    //     advancedControls.classList.toggle('hidden');
    
    //     //save the state to a cookie
    //     const isHidden = advancedControls.classList.contains('hidden');
    //     document.cookie = `ollamaPanelHidden=${isHidden}; path=/; max-age=31536000`; // 1 year
    // }); 
    
    // movingParams = {
    //     temperature: 0.7,
    //     top_k: 40,
    //     top_p: 0.9,
    //     min_k: 1
    // }
    
    // function sendParams() {
    //     socket.emit('ollamaParamsPush', { movingParams });
    //     console.log('Parameters sent:', movingParams);
    // }
    
    // document.getElementById('ollama-temperature').addEventListener('input', (e) => {
    //     const temperature = parseFloat(e.target.value);
    //     if (!isNaN(temperature)) {
    //         movingParams.temperature = temperature;
    //         sendParams();
    //     }
    // });
    
    // document.getElementById('ollama-top_k').addEventListener('input', (e) => {
    //     const top_k = parseInt(e.target.value, 10);
    //     if (!isNaN(top_k)) {
    //         movingParams.top_k = top_k;
    //         sendParams();
    //     }
    // });
    
    // document.getElementById('ollama-top_p').addEventListener('input', (e) => {
    //     const top_p = parseFloat(e.target.value);
    //     if (!isNaN(top_p)) {
    //         movingParams.top_p = top_p;
    //         sendParams();
    //     }
    // });
    
    // document.getElementById('ollama-min_k').addEventListener('input', (e) => {
    //     const min_k = parseInt(e.target.value, 10);
    //     if (!isNaN(min_k)) {
    //         movingParams.min_k = min_k;
    //         sendParams();
    //     }
    // });
    
