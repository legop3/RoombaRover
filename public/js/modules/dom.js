// Cache DOM elements once after the DOM is ready
console.log("DOM JS loaded");

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

export { dom };