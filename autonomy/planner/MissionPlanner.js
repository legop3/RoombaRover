const EventEmitter = require('events');

let nextStepId = 1;

class MissionPlanner extends EventEmitter {
  constructor(behaviorManager, worldModel, options = {}) {
    super();
    this.behaviorManager = behaviorManager;
    this.worldModel = worldModel;

    this.queue = [];
    this.activeStep = null;
    this.history = [];
    this.goalHistory = [];
    this.currentGoalText = null;
    this.running = false;

    this.autoExplore = options.autoExplore !== false;
    this.autoExploreCooldownMs = options.autoExploreCooldownMs || 20000;
    this.nextAutoExploreAt = Date.now();
    this.defaultAutoStep = options.defaultAutoStep || 'wander';

    if (this.behaviorManager) {
      this.behaviorManager.on('cycle-complete', () => this.tick());
      this.behaviorManager.on('reflex', (event) => this._handleReflex(event));
      this.behaviorManager.on('state', (state) => this._handleBehaviorState(state));
    }
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.tick();
  }

  stop() {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.activeStep = null;
    this.queue = [];
    this.emit('mission-updated', this.getStatusSnapshot({ reason: 'planner-stopped' }));
  }

  clearQueue(reason = 'cleared') {
    this.queue = [];
    this.emit('mission-updated', this.getStatusSnapshot({ reason }));
  }

  ingestLLMGoal(goalText, options = {}) {
    if (!goalText || typeof goalText !== 'string') {
      return;
    }
    const trimmed = goalText.trim();
    if (!trimmed) {
      return;
    }

    const source = options.source || 'llm';
    this.currentGoalText = trimmed;
    this.goalHistory.push({ text: trimmed, at: Date.now(), source });
    if (this.goalHistory.length > 20) {
      this.goalHistory.shift();
    }

    const steps = this._parseGoalToSteps(trimmed);

    if (!options.append) {
      this.queue = [];
      if (this.activeStep) {
        this._completeStep('replaced');
      }
      if (this.behaviorManager) {
        this.behaviorManager.halt('new-goal');
      }
      this.activeStep = null;
    }

    this.queue.push(...steps);
    this.emit('mission-updated', this.getStatusSnapshot({ reason: 'new-goal', source }));
    this.tick();
  }

  ingestDirective(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return;
    }
    const directive = text.trim();
    if (!directive) {
      return;
    }

    const lower = directive.toLowerCase();
    if (lower.startsWith('clear')) {
      this.clearQueue('directive-clear');
      return;
    }
    if (lower.startsWith('pause') || lower.startsWith('hold')) {
      this.queue.unshift(this._createStep('idle', {
        durationMs: this._extractDuration(lower) || 5000,
        note: 'pause directive',
        source: 'directive',
      }));
      this.emit('mission-updated', this.getStatusSnapshot({ reason: 'directive-pause' }));
      this.tick();
      return;
    }

    const steps = this._parseGoalToSteps(directive);
    if (options.prepend || lower.startsWith('now')) {
      this.queue = steps.concat(this.queue);
    } else {
      this.queue.push(...steps);
    }
    this.emit('mission-updated', this.getStatusSnapshot({ reason: 'directive', directive }));
    this.tick();
  }

  tick() {
    if (!this.running) {
      return;
    }
    const now = Date.now();

    if (this.activeStep && this.activeStep.deadline && now >= this.activeStep.deadline) {
      this._completeStep('deadline');
    }

    if (!this.activeStep) {
      if (this.queue.length === 0 && this.autoExplore && now >= this.nextAutoExploreAt) {
        this.queue.push(this._createStep(this.defaultAutoStep, {
          durationMs: 15000,
          note: 'auto-explore pulse',
          source: 'auto',
          auto: true,
        }));
        this.nextAutoExploreAt = now + this.autoExploreCooldownMs;
      }

      if (this.queue.length > 0) {
        const nextStep = this.queue.shift();
        this._startStep(nextStep);
      } else if (this.behaviorManager && this.autoExplore) {
        this.behaviorManager.setBehavior(this.defaultAutoStep, {}, {
          source: 'auto',
          reason: 'idle-auto',
        });
      }
    }
  }

  describeStatus() {
    const active = this.activeStep ? `${this.activeStep.behavior}${this.activeStep.deadline ? ` (until ${Math.round((this.activeStep.deadline - Date.now()) / 1000)}s)` : ''}` : 'idle';
    const queuePreview = this.queue.map((step) => step.behavior).slice(0, 3).join(' -> ') || 'empty';
    const goal = this.currentGoalText || 'none';
    return `goal: ${goal}. active_step: ${active}. queue: ${queuePreview}. auto_explore: ${this.autoExplore}`;
  }

  markStepComplete(reason = 'completed') {
    this._completeStep(reason);
    this.tick();
  }

  failActiveStep(reason = 'failed') {
    this._completeStep(`failed:${reason}`);
    this.tick();
  }

  getStatusSnapshot(extras = {}) {
    return {
      running: this.running,
      currentGoal: this.currentGoalText,
      activeStep: this._summarizeStep(this.activeStep),
      queue: this.queue.map((step) => this._summarizeStep(step)),
      history: this.history.slice(-8).map((step) => this._summarizeStep(step)),
      autoExplore: this.autoExplore,
      nextAutoExploreAt: this.nextAutoExploreAt,
      goalHistory: this.goalHistory.slice(-8),
      ...extras,
    };
  }

  _startStep(step) {
    if (!step) {
      return;
    }
    const prepared = {
      ...step,
      status: 'active',
      startedAt: Date.now(),
    };
    if (step.durationMs) {
      prepared.deadline = Date.now() + step.durationMs;
    }
    this.activeStep = prepared;
    if (this.behaviorManager) {
      this.behaviorManager.setBehavior(step.behavior, step.params || {}, {
        source: 'mission-planner',
        reason: step.note || step.source || 'mission-step',
      });
    }
    this.emit('mission-updated', this.getStatusSnapshot({ reason: 'step-started', stepId: step.id }));
  }

  _completeStep(result = 'completed') {
    if (this.activeStep) {
      const finished = {
        ...this.activeStep,
        status: result.startsWith('failed') ? 'failed' : 'completed',
        completedAt: Date.now(),
        result,
      };
      this.history.push(finished);
      if (this.history.length > 20) {
        this.history.shift();
      }
    }
    this.activeStep = null;
    if (this.behaviorManager && !this.queue.length) {
      this.behaviorManager.setBehavior(this.defaultAutoStep, {}, {
        source: 'mission-planner',
        reason: 'step-finished',
      });
    }
    this.emit('mission-updated', this.getStatusSnapshot({ reason: `step-${result}` }));
  }

  _handleReflex(event) {
    if (!this.running || !this.activeStep) {
      return;
    }
    this.activeStep.lastReflex = event;
    this.emit('mission-updated', this.getStatusSnapshot({ reason: 'reflex', event }));
  }

  _handleBehaviorState(state) {
    if (!this.running || !this.activeStep) {
      return;
    }
    if (state && state.reason && state.reason.includes('scan-finished') && this.activeStep.behavior === 'scan') {
      this.markStepComplete('behavior-finished');
    }
  }

  _parseGoalToSteps(goalText) {
    const lower = goalText.toLowerCase();
    const steps = [];
    const durationMs = this._extractDuration(goalText) || 15000;

    if (lower.includes('dock') || lower.includes('charge') || lower.includes('base')) {
      steps.push(this._createStep('dock_seek', {
        durationMs: Math.max(durationMs, 20000),
        note: 'search for dock',
        source: 'goal',
      }));
      return steps;
    }

    if (lower.includes('wall')) {
      const side = lower.includes('right') ? 'right' : 'left';
      steps.push(this._createStep('wall_follow', {
        params: { side },
        durationMs,
        note: `follow ${side} wall`,
        source: 'goal',
      }));
      return steps;
    }

    if (lower.includes('scan') || lower.includes('inspect') || lower.includes('look around')) {
      steps.push(this._createStep('scan', {
        params: { turnSize: 60, cycles: 6 },
        durationMs: Math.max(durationMs, 8000),
        note: 'slow scan',
        source: 'goal',
      }));
      if (lower.includes('explore') || lower.includes('then') || !lower.includes('stop')) {
        steps.push(this._createStep('wander', {
          durationMs,
          note: 'resume exploring',
          source: 'goal',
        }));
      }
      return steps;
    }

    if (lower.includes('patrol') || lower.includes('explore') || lower.includes('wander')) {
      steps.push(this._createStep('wander', {
        durationMs,
        note: 'explore area',
        source: 'goal',
      }));
      return steps;
    }

    if (lower.includes('idle') || lower.includes('wait') || lower.includes('hold position')) {
      steps.push(this._createStep('idle', {
        durationMs: Math.max(durationMs, 5000),
        note: 'hold still',
        source: 'goal',
      }));
      return steps;
    }

    if (lower.includes('follow') && lower.includes('light')) {
      steps.push(this._createStep('wander', {
        durationMs,
        note: 'approach bright area',
        source: 'goal',
      }));
      return steps;
    }

    steps.push(this._createStep('wander', {
      durationMs,
      note: 'default explore',
      source: 'goal',
    }));
    return steps;
  }

  _extractDuration(text) {
    const seconds = text.match(/(\d+)\s*(seconds|second|sec|s)/i);
    if (seconds) {
      return Number.parseInt(seconds[1], 10) * 1000;
    }
    const minutes = text.match(/(\d+)\s*(minutes|minute|min)/i);
    if (minutes) {
      return Number.parseInt(minutes[1], 10) * 60000;
    }
    return null;
  }

  _createStep(behavior, { params = {}, durationMs = 10000, note = '', source = 'planner', auto = false } = {}) {
    return {
      id: nextStepId++,
      behavior,
      params,
      durationMs,
      note,
      source,
      status: 'queued',
      createdAt: Date.now(),
      auto,
    };
  }

  _summarizeStep(step) {
    if (!step) {
      return null;
    }
    return {
      id: step.id,
      behavior: step.behavior,
      params: step.params,
      durationMs: step.durationMs,
      note: step.note,
      source: step.source,
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      deadline: step.deadline,
      result: step.result,
      auto: step.auto,
    };
  }
}

module.exports = {
  MissionPlanner,
};
