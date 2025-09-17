const EventEmitter = require('events');

const DEFAULT_WANDER_SPEED = 160;
const DEFAULT_ROTATE_SPEED = 120;
const WALL_TARGET_INTENSITY = 250;

class BehaviorManager extends EventEmitter {
  constructor(controller, worldModel, options = {}) {
    super();
    this.controller = controller;
    this.worldModel = worldModel;

    this.enabled = false;
    this.currentBehavior = 'idle';
    this.currentParams = {};
    this.currentMeta = {};
    this.behaviorState = null;
    this.behaviorStack = [];
    this.manualOverrideActive = false;
    this.latestSensors = null;
    this.defaultBehavior = options.defaultBehavior || 'wander';
    this.recentReflexes = [];
    this.lastBumpTrigger = 0;
    this.lastCycleAt = null;
    this.lastManualCommand = null;

    if (this.controller) {
      this.controller.on('roomba:done', (movement) => this._onMovementComplete(movement));
      this.controller.on('roomba:queue-empty', () => this._onQueueEmpty());
    }
  }

  enableAutonomy(reason = 'enabled') {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    this.behaviorState = null;
    if (this.currentBehavior === 'idle') {
      this.setBehavior(this.defaultBehavior, { reason: 'auto-start' }, { source: 'autonomy', forceImmediate: true });
    }
    this.emit('state', this.getStatusSnapshot({ reason }));
  }

  disableAutonomy(reason = 'disabled') {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    this.behaviorStack = [];
    this.manualOverrideActive = false;
    this.halt(reason);
    this.currentBehavior = 'idle';
    this.currentParams = {};
    this.currentMeta = { reason, source: 'autonomy' };
    this.emit('state', this.getStatusSnapshot({ reason }));
  }

  halt(reason = 'halted') {
    if (this.controller) {
      this.controller.stop();
      this.controller.clearQueue();
    }
    this.behaviorState = null;
    this.emit('state', this.getStatusSnapshot({ reason, halted: true }));
  }

  setDefaultBehavior(name, params = {}) {
    this.defaultBehavior = name || 'wander';
    if (Object.keys(params).length) {
      this.defaultBehaviorParams = params;
    }
    this.emit('state', this.getStatusSnapshot({ reason: 'default-updated' }));
  }

  setBehavior(name, params = {}, meta = {}) {
    const normalizedName = name || 'idle';
    const previous = {
      name: this.currentBehavior,
      params: this.currentParams,
      meta: this.currentMeta,
    };

    if (meta.stack && previous.name && previous.name !== 'idle') {
      this.behaviorStack.push({ name: previous.name, params: previous.params, meta: previous.meta });
    }

    this.currentBehavior = normalizedName;
    this.currentParams = params || {};
    this.currentMeta = {
      ...meta,
      source: meta.source || 'planner',
      startedAt: Date.now(),
    };
    this.behaviorState = {
      startedAt: Date.now(),
      meta: this.currentMeta,
      name: this.currentBehavior,
      params: this.currentParams,
    };

    if (normalizedName === 'idle') {
      this.halt(meta.reason || 'idle');
    } else if (!meta.skipDrive) {
      this._executeBehavior(normalizedName, meta);
    }

    this.emit('state', this.getStatusSnapshot({ reason: meta.reason || 'behavior-change' }));
  }

  restorePreviousBehavior(reason = 'resume') {
    const resume = this.behaviorStack.pop();
    if (resume) {
      this.setBehavior(resume.name, resume.params, {
        ...resume.meta,
        source: 'behavior-manager',
        reason,
        skipDrive: false,
      });
    } else if (this.enabled) {
      this.setBehavior(this.defaultBehavior, this.defaultBehaviorParams || {}, {
        source: 'behavior-manager',
        reason: `${reason} (fallback)`
      });
    } else {
      this.setBehavior('idle', {}, { source: 'behavior-manager', reason: `${reason} (disabled)` });
    }
  }

  enqueueManualMotion(action, rawValue) {
    const value = Number.parseFloat(rawValue);
    if (!Number.isFinite(value)) {
      return;
    }

    let distance = 0;
    let turn = 0;
    switch (action) {
      case 'forward':
        distance = Math.max(20, Math.min(600, value));
        break;
      case 'backward':
        distance = -Math.max(20, Math.min(600, Math.abs(value)));
        break;
      case 'left':
        turn = Math.max(5, Math.min(180, value));
        break;
      case 'right':
        turn = -Math.max(5, Math.min(180, value));
        break;
      default:
        return;
    }

    if (this.controller) {
      this.controller.stop();
      this.controller.clearQueue();
      this.manualOverrideActive = true;
      this.lastManualCommand = {
        issuedAt: Date.now(),
        action,
        value,
      };
      this.controller.move(distance, turn, DEFAULT_WANDER_SPEED);
      this.emit('manual-override', {
        action,
        value,
        timestamp: Date.now(),
      });
    }
    this.emit('state', this.getStatusSnapshot({ reason: 'manual-override' }));
  }

  updateSensors(sensorData = {}) {
    this.latestSensors = sensorData;
    if (this.worldModel) {
      this.worldModel.updateFromSensors({
        ...sensorData,
        batteryPercentage: sensorData.batteryPercentage,
      });
    }

    const now = Date.now();
    const bump = Boolean(sensorData.bumpLeft || sensorData.bumpRight);
    const cliff = Array.isArray(sensorData.cliffSensors) && sensorData.cliffSensors.some(value => value < 100);

    if (this.enabled && !this.manualOverrideActive) {
      if (bump && now - this.lastBumpTrigger > 600) {
        const direction = sensorData.bumpLeft ? 'left' : sensorData.bumpRight ? 'right' : 'unknown';
        this.lastBumpTrigger = now;
        this.recentReflexes.push({
          type: 'bump',
          direction,
          at: now,
        });
        if (this.recentReflexes.length > 8) {
          this.recentReflexes.shift();
        }
        this.emit('reflex', { type: 'bump', direction, at: now });
        this.setBehavior('avoid', { direction }, {
          source: 'reflex',
          reason: 'bump-detected',
          stack: true,
        });
        return;
      }

      if (cliff && this.currentBehavior !== 'avoid') {
        this.recentReflexes.push({ type: 'cliff', at: now });
        this.emit('reflex', { type: 'cliff', at: now });
        this.setBehavior('avoid', { direction: 'right', retreat: true }, {
          source: 'reflex',
          reason: 'cliff-detected',
          stack: true,
        });
        return;
      }
    }
  }

  describeStatus() {
    const snapshot = this.getStatusSnapshot();
    const pieces = [
      `enabled=${snapshot.enabled}`,
      `behavior=${snapshot.behavior}`,
    ];
    if (snapshot.behavior === 'wall_follow' && snapshot.params?.side) {
      pieces.push(`side=${snapshot.params.side}`);
    }
    if (snapshot.manualOverride) {
      pieces.push('manual=active');
    }
    if (this.recentReflexes.length) {
      const last = this.recentReflexes[this.recentReflexes.length - 1];
      pieces.push(`last_reflex=${last.type}`);
    }
    return pieces.join(', ');
  }

  getStatusSnapshot(extras = {}) {
    return {
      enabled: this.enabled,
      behavior: this.currentBehavior,
      params: this.currentParams,
      meta: this.currentMeta,
      manualOverride: this.manualOverrideActive,
      lastManualCommand: this.lastManualCommand,
      lastCycleAt: this.lastCycleAt,
      stackDepth: this.behaviorStack.length,
      recentReflexes: this.recentReflexes.slice(-5),
      latestSensors: this._condenseSensors(this.latestSensors),
      ...extras,
    };
  }

  _condenseSensors(sensorData) {
    if (!sensorData) {
      return null;
    }
    return {
      bumpLeft: sensorData.bumpLeft,
      bumpRight: sensorData.bumpRight,
      lightBumps: sensorData.lightBumps,
      dirtDetect: sensorData.dirtDetect,
    };
  }

  _executeBehavior(name, meta = {}) {
    if (!this.enabled && name !== 'idle' && !meta.allowWhileDisabled) {
      return;
    }

    switch (name) {
      case 'idle':
        this.halt(meta.reason || 'idle');
        break;
      case 'wander':
        this._queueWanderMove(true);
        break;
      case 'wall_follow':
        this._queueWallFollowMove(true);
        break;
      case 'scan':
        this._queueScanStep(true);
        break;
      case 'dock_seek':
        this._queueDockSeekStep(true);
        break;
      case 'avoid':
        this._queueAvoidSequence(meta);
        break;
      default:
        this.emit('log', `Unknown behavior '${name}'`);
    }
  }

  _queueWanderMove(forceTurn = false) {
    if (!this.controller || !this.enabled || this.manualOverrideActive) {
      return;
    }
    const distance = 180 + Math.random() * 160;
    let turn = 0;
    if (forceTurn || Math.random() < 0.35) {
      turn = (Math.random() - 0.5) * 120;
    }
    if (this.behaviorState) {
      this.behaviorState.lastPlannedMove = { distance, turn };
    }
    this.controller.move(distance, turn, DEFAULT_WANDER_SPEED);
  }

  _queueWallFollowMove(force = false) {
    if (!this.controller || !this.enabled || this.manualOverrideActive) {
      return;
    }
    const side = this.currentParams.side === 'right' ? 'right' : 'left';
    const light = this.latestSensors?.lightBumps || {};

    const leftValue = (light.centerLeft || 0) + (light.frontLeft || 0);
    const rightValue = (light.centerRight || 0) + (light.frontRight || 0);
    const target = WALL_TARGET_INTENSITY;

    let error;
    if (side === 'left') {
      error = target - leftValue;
    } else {
      error = target - rightValue;
    }

    let turnAdjust = error * 0.05;
    turnAdjust = Math.max(-25, Math.min(25, turnAdjust));

    if (Math.abs(leftValue - rightValue) < 40 && !force) {
      turnAdjust += side === 'left' ? 10 : -10;
    }

    const distance = 160;
    this.controller.move(distance, turnAdjust, DEFAULT_WANDER_SPEED);
    if (this.behaviorState) {
      this.behaviorState.lastPlannedMove = { distance, turn: turnAdjust };
    }
  }

  _queueScanStep(force = false) {
    if (!this.controller || !this.enabled || this.manualOverrideActive) {
      return;
    }
    const turn = this.currentParams.turnSize || 60;
    const cycles = this.currentParams.cycles || 6;
    const state = this.behaviorState || {};
    const completed = state.completedTurns || 0;

    if (!force && completed >= cycles) {
      this.restorePreviousBehavior('scan-finished');
      return;
    }

    this.controller.move(0, turn, DEFAULT_ROTATE_SPEED);
    this.behaviorState = {
      ...state,
      completedTurns: completed + 1,
      lastPlannedMove: { distance: 0, turn },
      awaitingResume: completed + 1 >= cycles,
      sequence: 'scan',
    };
  }

  _queueDockSeekStep(force = false) {
    if (!this.controller || !this.enabled || this.manualOverrideActive) {
      return;
    }
    const state = this.behaviorState || {};
    const phase = state.phase || 0;
    if (force) {
      this.behaviorState = { ...state, phase: 0 };
    }
    if (phase % 2 === 0) {
      this.controller.move(-120, 0, DEFAULT_WANDER_SPEED);
    } else {
      this.controller.move(0, 45, DEFAULT_ROTATE_SPEED);
    }
    this.behaviorState = {
      ...this.behaviorState,
      phase: (phase + 1) % 6,
      lastPlannedMove: { distance: phase % 2 === 0 ? -120 : 0, turn: phase % 2 === 0 ? 0 : 45 },
    };
  }

  _queueAvoidSequence(meta = {}) {
    if (!this.controller) {
      return;
    }
    this.controller.stop();
    this.controller.clearQueue();

    const direction = meta.direction === 'left' || this.currentParams.direction === 'left' ? 'left' : 'right';
    const turn = direction === 'left' ? -60 : 60;
    const retreatDistance = meta.retreat ? -200 : -150;

    this.controller.move(retreatDistance, 0, DEFAULT_WANDER_SPEED);
    this.controller.move(0, turn, DEFAULT_ROTATE_SPEED);
    this.controller.move(150, 0, DEFAULT_WANDER_SPEED);

    this.behaviorState = {
      ...this.behaviorState,
      sequence: 'avoid',
      awaitingResume: true,
      resumeReason: meta.reason || 'avoid-finished',
      lastPlannedMove: { distance: 150, turn: 0 },
    };
  }

  _onMovementComplete(movement) {
    this.lastCycleAt = Date.now();
    if (this.worldModel) {
      this.worldModel.recordMovement(movement.distanceMm, movement.turnDeg);
    }
    this.emit('cycle-complete', {
      behavior: this.currentBehavior,
      timestamp: this.lastCycleAt,
      movement,
    });
  }

  _onQueueEmpty() {
    if (this.manualOverrideActive) {
      this.manualOverrideActive = false;
      if (this.enabled && this.currentBehavior !== 'idle') {
        this._driveBehavior(false);
      }
      this.emit('state', this.getStatusSnapshot({ reason: 'manual-complete' }));
      return;
    }

    if (this.behaviorState && this.behaviorState.awaitingResume) {
      const reason = this.behaviorState.resumeReason || 'sequence-complete';
      this.behaviorState.awaitingResume = false;
      this.restorePreviousBehavior(reason);
      return;
    }

    if (!this.enabled) {
      return;
    }

    this._driveBehavior(false);
  }

  _driveBehavior(force) {
    switch (this.currentBehavior) {
      case 'wander':
        this._queueWanderMove(force);
        break;
      case 'wall_follow':
        this._queueWallFollowMove(force);
        break;
      case 'scan':
        this._queueScanStep(force);
        break;
      case 'dock_seek':
        this._queueDockSeekStep(force);
        break;
      case 'avoid':
        // avoid is scheduled immediately when set
        break;
      default:
        break;
    }
  }
}

module.exports = {
  BehaviorManager,
};
