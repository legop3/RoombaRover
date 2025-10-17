import { initializeLayout } from './newdriveCore/layoutController.js';
import { initializeTabs } from './newdriveCore/tabs.js';
import { initializeDriveIframes } from './newdriveCore/driveIframeManager.js';

const layoutDefault = document.getElementById('layout-default');
const layoutLandscape = document.getElementById('layout-landscape');
const fullscreenControls = document.getElementById('fullscreen-controls');
const fullscreenTrigger = document.getElementById('fullscreen-trigger');

initializeDriveIframes();

initializeLayout({
  layoutDefault,
  layoutLandscape,
  fullscreenControls,
  fullscreenTrigger,
});

initializeTabs();

import {} from './modules/socketGlobal.js'
// import {} from './modules/iframeAutomation.js'
import {} from './modules/homeAssistantLights.js'
import {} from './modules/roomCamera.js'
import {} from './modules/presence.js'
