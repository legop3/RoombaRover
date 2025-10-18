import { socket } from '../modules/socketGlobal.js';

const MAX_SPEED = 200;
const EMIT_INTERVAL_MS = 150;

const CONTROL_MAPPINGS = {
  'aux-main-1': {
    down: () => socket.emit('brushMotor', { speed: 127 }),
    up: () => socket.emit('brushMotor', { speed: 0 }),
  },
  'aux-main-0': {
    down: () => socket.emit('brushMotor', { speed: -127 }),
    up: () => socket.emit('brushMotor', { speed: 0 }),
  },
  'aux-side-1': {
    down: () => socket.emit('sideBrush', { speed: 127 }),
    up: () => socket.emit('sideBrush', { speed: 0 }),
  },
  'aux-side-0': {
    down: () => socket.emit('sideBrush', { speed: -127 }),
    up: () => socket.emit('sideBrush', { speed: 0 }),
  },
  'aux-vac-1': {
    down: () => socket.emit('vacuumMotor', { speed: 127 }),
    up: () => socket.emit('vacuumMotor', { speed: 0 }),
  },
  'aux-all-1': {
    down: () => {
      socket.emit('brushMotor', { speed: 127 });
      socket.emit('sideBrush', { speed: 127 });
      socket.emit('vacuumMotor', { speed: 127 });
    },
    up: () => {
      socket.emit('brushMotor', { speed: 0 });
      socket.emit('sideBrush', { speed: 0 });
      socket.emit('vacuumMotor', { speed: 0 });
    },
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function attachJoystick(zone) {
  if (typeof window === 'undefined' || !window.nipplejs) {
    console.warn('[joystickDriver] nipplejs library not found; joystick disabled.');
    return;
  }

  const joystick = window.nipplejs.create({
    zone,
    mode: 'dynamic',
    color: 'pink',
    size: Number(zone.dataset.joystickSize) || 200,
  });

  let lastEmit = 0;

  joystick.on('move', (_, data) => {
    if (!data || !data.vector) {
      return;
    }

    const now = Date.now();
    if (now - lastEmit < EMIT_INTERVAL_MS) {
      return;
    }
    lastEmit = now;

    let leftSpeed = data.vector.y * MAX_SPEED + data.vector.x * MAX_SPEED;
    let rightSpeed = data.vector.y * MAX_SPEED - data.vector.x * MAX_SPEED;

    leftSpeed = Math.round(clamp(leftSpeed, -MAX_SPEED, MAX_SPEED));
    rightSpeed = Math.round(clamp(rightSpeed, -MAX_SPEED, MAX_SPEED));

    socket.emit('Speedchange', {
      leftSpeed,
      rightSpeed,
      timestamp: now,
    });
  });

  joystick.on('end', () => {
    socket.emit('Speedchange', {
      leftSpeed: 0,
      rightSpeed: 0,
      timestamp: Date.now(),
    });
  });
}

function attachAuxButton(button) {
  const controlKey = button.dataset.control;
  const mapping = controlKey ? CONTROL_MAPPINGS[controlKey] : null;
  if (!mapping) {
    return;
  }

  const handleDown = (event) => {
    event.preventDefault();
    if (typeof button.setPointerCapture === 'function') {
      try {
        button.setPointerCapture(event.pointerId);
      } catch (err) {
        // ignore if pointer capture is not supported
      }
    }
    mapping.down?.();
  };

  const handleUp = () => {
    mapping.up?.();
  };

  button.addEventListener('pointerdown', handleDown);
  button.addEventListener('pointerup', handleUp);
  button.addEventListener('pointerleave', handleUp);
  button.addEventListener('pointercancel', handleUp);
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

function initJoysticks() {
  const zones = Array.from(document.querySelectorAll('[data-joystick-zone]'));
  zones.forEach((zone) => {
    try {
      attachJoystick(zone);
    } catch (error) {
      console.error('[joystickDriver] Failed to initialize joystick:', error);
    }
  });
}

function initAuxButtons() {
  const buttons = Array.from(document.querySelectorAll('[data-control]'));
  buttons.forEach((button) => {
    try {
      attachAuxButton(button);
    } catch (error) {
      console.error('[joystickDriver] Failed to initialize control button:', error);
    }
  });
}

function init() {
  initJoysticks();
  initAuxButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
