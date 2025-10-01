const EventEmitter = require('events');

class TurnManager extends EventEmitter {
    constructor(accessControl, options = {}) {
        super();
        this.accessControl = accessControl;
        this.turnDurationMs = Math.max(5000, options.turnDurationMs || 120000);
        this.noShowGraceMs = Math.max(1000, options.noShowGraceMs || 5000);
        this.queue = [];
        this.currentTurn = null;
        this.timer = null;
        this.active = false;
    }

    start() {
        if (this.active) {
            return;
        }

        this.active = true;
        this._synchroniseQueue();
        this._startNextTurnIfIdle();
        this._emitState();
    }

    stop() {
        if (!this.active) {
            return;
        }

        this.active = false;
        this._clearTimer();
        const previous = this.currentTurn;
        this.currentTurn = null;
        this.queue = [];
        if (previous) {
            this.emit('turnEnded', { turn: previous, reason: 'stopped' });
        }
        this._emitState();
    }

    setDuration(durationMs) {
        const safeDuration = Math.max(5000, Number(durationMs) || this.turnDurationMs);
        this.turnDurationMs = safeDuration;
        if (this.currentTurn) {
            this.currentTurn.endsAt = this.currentTurn.startedAt + this.turnDurationMs;
            this._rescheduleTimer();
        }
        this._emitState();
    }

    getDuration() {
        return this.turnDurationMs;
    }

    setNoShowGrace(durationMs) {
        this.noShowGraceMs = Math.max(1000, Number(durationMs) || this.noShowGraceMs);
        this._emitState();
    }

    getNoShowGrace() {
        return this.noShowGraceMs;
    }

    enqueue(socketId) {
        if (!this.active) {
            return;
        }

        if (!this.accessControl.hasSocket(socketId)) {
            return;
        }

        if (this._isCurrent(socketId) || this.queue.includes(socketId)) {
            return;
        }

        this.queue.push(socketId);
        this._emitState();
        this._startNextTurnIfIdle();
    }

    remove(socketId) {
        const index = this.queue.indexOf(socketId);
        if (index !== -1) {
            this.queue.splice(index, 1);
            this._emitState();
        }

        if (this._isCurrent(socketId)) {
            this._endCurrentTurn('disconnect', { requeue: false });
        }
    }

    handleNoShow(socketId) {
        if (this._isCurrent(socketId)) {
            this._endCurrentTurn('no-show', { requeue: false });
        } else {
            this.remove(socketId);
        }
    }

    markActivity(socketId) {
        if (this._isCurrent(socketId)) {
            this.currentTurn.lastActivity = Date.now();
        }
    }

    skipCurrentTurn() {
        if (this.currentTurn) {
            this._endCurrentTurn('skipped');
        }
    }

    getState() {
        const now = Date.now();
        const current = this.currentTurn
            ? {
                socketId: this.currentTurn.socketId,
                startedAt: this.currentTurn.startedAt,
                endsAt: this.currentTurn.endsAt
            }
            : null;

        let baseTime = now;
        if (this.currentTurn) {
            baseTime = this.currentTurn.endsAt;
        }

        const queue = this.queue.map((socketId, index) => ({
            socketId,
            position: index + 1,
            estimatedStart: baseTime + index * this.turnDurationMs
        }));

        return {
            active: this.active,
            currentTurn: current,
            queue,
            turnDurationMs: this.turnDurationMs,
            noShowGraceMs: this.noShowGraceMs
        };
    }

    _synchroniseQueue() {
        const knownNonAdmins = this.accessControl.listNonAdmins().map((record) => record.id);
        this.queue = this.queue.filter((socketId) => knownNonAdmins.includes(socketId));

        knownNonAdmins.forEach((socketId) => {
            if (!this._isCurrent(socketId) && !this.queue.includes(socketId)) {
                this.queue.push(socketId);
            }
        });
    }

    _startNextTurnIfIdle() {
        if (!this.active || this.currentTurn || this.queue.length === 0) {
            this._emitState();
            return;
        }

        const nextSocketId = this.queue.shift();
        if (!this.accessControl.hasSocket(nextSocketId)) {
            this._startNextTurnIfIdle();
            return;
        }

        this.accessControl.setDrivingForAllNonAdmins(false);
        this.accessControl.setDrivingAllowed(nextSocketId, true);

        const startedAt = Date.now();
        this.currentTurn = {
            socketId: nextSocketId,
            startedAt,
            endsAt: startedAt + this.turnDurationMs,
            lastActivity: startedAt
        };

        this.emit('turnStarted', { ...this.currentTurn });
        this._rescheduleTimer();
        this._emitState();
    }

    _endCurrentTurn(reason, options = {}) {
        if (!this.currentTurn) {
            return;
        }

        const turn = this.currentTurn;
        this._clearTimer();
        this.currentTurn = null;

        if (this.accessControl.hasSocket(turn.socketId)) {
            this.accessControl.setDrivingAllowed(turn.socketId, false);
        }

        const shouldRequeue = options.requeue !== false && this.accessControl.hasSocket(turn.socketId);
        if (shouldRequeue) {
            this.queue.push(turn.socketId);
        }

        this.emit('turnEnded', { turn, reason });
        this._emitState();
        this._startNextTurnIfIdle();
    }

    _rescheduleTimer() {
        this._clearTimer();
        if (!this.currentTurn) {
            return;
        }
        const delay = Math.max(0, this.currentTurn.endsAt - Date.now());
        this.timer = setTimeout(() => this._endCurrentTurn('timer'), delay);
    }

    _clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    _emitState() {
        this.emit('state', this.getState());
    }

    _isCurrent(socketId) {
        return this.currentTurn && this.currentTurn.socketId === socketId;
    }
}

module.exports = TurnManager;
