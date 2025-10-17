import { initializeLayout } from './newdriveCore/layoutController.js';
import { initializeTabs } from './newdriveCore/tabs.js';

const layoutDefault = document.getElementById('layout-default');
const layoutLandscape = document.getElementById('layout-landscape');
const fullscreenControls = document.getElementById('fullscreen-controls');
const fullscreenTrigger = document.getElementById('fullscreen-trigger');

initializeLayout({
  layoutDefault,
  layoutLandscape,
  fullscreenControls,
  fullscreenTrigger,
});

initializeTabs();

import {} from './modules/socketGlobal.js'
import {} from './modules/iframeAutomation.js'
import {} from './modules/homeAssistantLights.js'
import {} from './modules/roomCamera.js'
import {} from './modules/presence.js'