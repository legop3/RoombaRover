const EventEmitter = require('events');

const RELATIVE_LIGHT_ANGLES = {
  left: 135,
  frontLeft: 60,
  centerLeft: 25,
  centerRight: -25,
  frontRight: -60,
  right: -135,
};

const RELATIVE_DESCRIPTOR_BREAKS = [
  { max: 22.5, label: 'front' },
  { max: 67.5, label: 'front-right' },
  { max: 112.5, label: 'right' },
  { max: 157.5, label: 'rear-right' },
  { max: 180, label: 'rear' },
];

function normalizeAngle(deg) {
  const wrapped = deg % 360;
  return wrapped < -180 ? wrapped + 360 : wrapped > 180 ? wrapped - 360 : wrapped;
}

class WorldModel extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sectorCount = options.sectorCount || 12;
    this.ringCount = options.ringCount || 3;
    this.breadcrumbLimit = options.breadcrumbLimit || 60;
    this.summaryIntervalMs = options.summaryIntervalMs || 1500;

    this.sectors = Array.from({ length: this.sectorCount }, () => this._createSector());
    this.headingDeg = 0;
    this.position = { x: 0, y: 0 };
    this.breadcrumbs = [];
    this.interestingSightings = [];
    this.lastSummaryBroadcast = 0;
    this.lastSensorSnapshot = null;
    this.lastBatteryPercentage = null;
    this.lastMovementAt = Date.now();
    this.lastUpdate = Date.now();
    this.autoStuckCounter = 0;
  }

  _createSector() {
    return {
      obstacles: 0,
      lightScore: 0,
      forbiddenScore: 0,
      lastUpdated: 0,
      recentNotes: [],
    };
  }

  _sectorWidthDeg() {
    return 360 / this.sectorCount;
  }

  _sectorAngle(index) {
    const width = this._sectorWidthDeg();
    return index * width + width / 2;
  }

  _angleToSector(angleDeg) {
    const normalized = ((angleDeg % 360) + 360) % 360;
    const width = this._sectorWidthDeg();
    return Math.floor(normalized / width) % this.sectorCount;
  }

  _relativeDescriptor(angleDeg) {
    const relative = Math.abs(normalizeAngle(angleDeg - this.headingDeg));
    for (const bucket of RELATIVE_DESCRIPTOR_BREAKS) {
      if (relative <= bucket.max) {
        return bucket.label;
      }
    }
    // Mirror for left-hand side descriptors
    if (relative >= 180 - RELATIVE_DESCRIPTOR_BREAKS[1].max) {
      return 'rear-left';
    }
    if (relative >= 180 - RELATIVE_DESCRIPTOR_BREAKS[2].max) {
      return 'left';
    }
    if (relative >= 180 - RELATIVE_DESCRIPTOR_BREAKS[3].max) {
      return 'front-left';
    }
    return 'front-left';
  }

  recordMovement(distanceMm, turnDeg) {
    if (!Number.isFinite(distanceMm) || !Number.isFinite(turnDeg)) {
      return;
    }

    const midHeading = this.headingDeg + turnDeg / 2;
    const rad = (midHeading * Math.PI) / 180;

    this.position.x += Math.cos(rad) * distanceMm;
    this.position.y += Math.sin(rad) * distanceMm;

    this.headingDeg = normalizeAngle(this.headingDeg + turnDeg);
    this.lastMovementAt = Date.now();

    if (Math.hypot(distanceMm, turnDeg) > 20) {
      this._addBreadcrumb({
        x: this.position.x,
        y: this.position.y,
        heading: this.headingDeg,
        timestamp: Date.now(),
      });
    }

    this._emitSummaryMaybe(false);
  }

  _addBreadcrumb(breadcrumb) {
    this.breadcrumbs.push(breadcrumb);
    if (this.breadcrumbs.length > this.breadcrumbLimit) {
      this.breadcrumbs.shift();
    }
  }

  updateFromSensors(sensorData = {}) {
    this.lastSensorSnapshot = sensorData;
    this.lastUpdate = Date.now();

    if (typeof sensorData.batteryPercentage === 'number') {
      this.lastBatteryPercentage = sensorData.batteryPercentage;
    }

    if (sensorData.bumpLeft || sensorData.bumpRight) {
      const relativeAngle = sensorData.bumpLeft ? 30 : -30;
      this._markObstacle(relativeAngle, 'contact');
    }

    if (Array.isArray(sensorData.cliffSensors)) {
      const dangerous = sensorData.cliffSensors.some(value => value < 100);
      if (dangerous) {
        this._markObstacle(0, 'cliff');
      }
    }

    if (sensorData.lightBumps) {
      this._processLightBumps(sensorData.lightBumps);
    }

    if (sensorData.dirtDetect && sensorData.dirtDetect > 0) {
      this._logSighting(`dirt sensor spike (${sensorData.dirtDetect})`, 'maintenance');
    }

    this._emitSummaryMaybe(false);
  }

  _processLightBumps(lightBumps) {
    const entries = Object.entries(lightBumps);
    if (!entries.length) {
      return;
    }

    let peak = { key: null, value: -Infinity };
    for (const [key, value] of entries) {
      const numeric = Number(value) || 0;
      if (numeric > peak.value) {
        peak = { key, value: numeric };
      }
    }

    const threshold = 120;
    for (const [key, value] of entries) {
      const numeric = Number(value) || 0;
      const relAngle = RELATIVE_LIGHT_ANGLES[key] ?? 0;
      const descriptor = numeric > threshold ? 'proximity' : 'ambient';
      if (descriptor === 'proximity') {
        this._markObstacle(relAngle, `light-${key}`);
      }
      this._accumulateLight(relAngle, numeric);
    }

    if (peak.key && peak.value > threshold * 2) {
      this._logSighting(`bright return ${peak.key} (${Math.round(peak.value)})`, 'vision');
    }
  }

  _markObstacle(relativeAngle, note) {
    const absoluteAngle = normalizeAngle(this.headingDeg + relativeAngle);
    const sector = this._angleToSector(absoluteAngle);
    const sectorData = this.sectors[sector];
    sectorData.obstacles += 1;
    sectorData.forbiddenScore = Math.min(sectorData.forbiddenScore + 1, 10);
    sectorData.lastUpdated = Date.now();
    if (note) {
      sectorData.recentNotes.push({ note, at: Date.now() });
      if (sectorData.recentNotes.length > 5) {
        sectorData.recentNotes.shift();
      }
    }
    this._emitSummaryMaybe(false);
  }

  _accumulateLight(relativeAngle, value) {
    const absoluteAngle = normalizeAngle(this.headingDeg + relativeAngle);
    const sector = this._angleToSector(absoluteAngle);
    const sectorData = this.sectors[sector];
    sectorData.lightScore = Math.round((sectorData.lightScore * 0.7) + value * 0.3);
    sectorData.lastUpdated = Date.now();
  }

  _logSighting(description, category = 'generic') {
    this.interestingSightings.push({
      description,
      category,
      at: Date.now(),
    });
    if (this.interestingSightings.length > 30) {
      this.interestingSightings.shift();
    }
  }

  describeForLLM() {
    const posX = Math.round(this.position.x);
    const posY = Math.round(this.position.y);
    const heading = Math.round(((this.headingDeg % 360) + 360) % 360);

    const obstacleSummary = this._buildObstacleSummary();
    const interesting = this.interestingSightings.slice(-3).map(entry => entry.description);
    const battery = this.lastBatteryPercentage != null ? `${this.lastBatteryPercentage}%` : 'unknown';
    const timeSinceMovement = Math.round((Date.now() - this.lastMovementAt) / 1000);

    return `pose_mm: (${posX}, ${posY}), heading: ${heading}deg. battery: ${battery}. ` +
      `recent_obstacles: ${obstacleSummary || 'none observed'}. ` +
      `recent_sightings: ${interesting.join('; ') || 'none'}. ` +
      `stopped_for: ${timeSinceMovement}s.`;
  }

  _buildObstacleSummary() {
    const descriptorCounts = {};
    this.sectors.forEach((sectorData, index) => {
      if (sectorData.obstacles <= 0 && sectorData.forbiddenScore <= 0) {
        return;
      }
      const label = this._relativeDescriptor(this._sectorAngle(index));
      descriptorCounts[label] = (descriptorCounts[label] || 0) + sectorData.obstacles;
    });

    return Object.entries(descriptorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, count]) => `${label} x${count}`)
      .join(', ');
  }

  getBreadcrumbs() {
    return this.breadcrumbs.slice();
  }

  getLastSummaryPayload() {
    return {
      summary: this.describeForLLM(),
      heading: this.headingDeg,
      position: { ...this.position },
      breadcrumbs: this.getBreadcrumbs(),
      lastSensorSnapshot: this.lastSensorSnapshot,
      batteryPercentage: this.lastBatteryPercentage,
      updatedAt: this.lastUpdate,
    };
  }

  forceEmitSummary() {
    this._emitSummaryMaybe(true);
  }

  _emitSummaryMaybe(force) {
    const now = Date.now();
    if (!force && now - this.lastSummaryBroadcast < this.summaryIntervalMs) {
      return;
    }
    this.lastSummaryBroadcast = now;
    this.emit('summary', this.getLastSummaryPayload());
  }
}

module.exports = {
  WorldModel,
};
