import './modules/socketGlobal.js';
import './modules/adminLogin.js';
import './modules/homeAssistantLights.js';
import './modules/roomCamera.js';
import './modules/presence.js';
import './modules/adminControls.js';
import { initializeDriveIframes } from './newdriveCore/driveIframeManager.js';
import { initializeTabs } from './newdriveCore/tabs.js';

initializeDriveIframes();
initializeTabs();
