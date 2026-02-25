/**
 * In-memory statistics store
 * When DATABASE_PATH (or SQLITE_PATH) is set, uses SQLite for activity logs and summary.
 */
const db = require('./db');

class StatsStore {
  constructor() {
    this.startTime = new Date();
    this.totalReceived = 0;
    this.targets = {};
    this.recentFailures = []; // last 50 failures
    this.recentActivity = []; // last 100 forwarding attempts
  }

  initTarget(targetId) {
    if (db.isEnabled()) return;
    if (!this.targets[targetId]) {
      this.targets[targetId] = {
        id: targetId,
        success: 0,
        failure: 0,
        lastSuccess: null,
        lastFailure: null,
        totalAttempts: 0,
        avgResponseMs: 0,
        _totalResponseMs: 0,
      };
    }
  }

  incrementReceived() {
    if (db.isEnabled()) {
      return db.incrementReceived();
    }
    this.totalReceived++;
  }

  recordSuccess(targetId, requestId, durationMs) {
    if (db.isEnabled()) {
      return db.insertActivity({
        requestId,
        targetId,
        status: 'success',
        durationMs,
        timestamp: new Date().toISOString(),
      });
    }
    this.initTarget(targetId);
    const t = this.targets[targetId];
    t.success++;
    t.totalAttempts++;
    t.lastSuccess = new Date().toISOString();
    t._totalResponseMs += durationMs;
    t.avgResponseMs = Math.round(t._totalResponseMs / t.totalAttempts);

    this._addActivity({ requestId, targetId, status: 'success', durationMs, timestamp: new Date().toISOString() });
  }

  recordFailure(targetId, requestId, error, durationMs) {
    if (db.isEnabled()) {
      return db.insertActivity({
        requestId,
        targetId,
        status: 'failure',
        error: error?.message || String(error),
        statusCode: error?.statusCode,
        durationMs,
        timestamp: new Date().toISOString(),
      });
    }
    this.initTarget(targetId);
    const t = this.targets[targetId];
    t.failure++;
    t.totalAttempts++;
    t.lastFailure = new Date().toISOString();
    t._totalResponseMs += durationMs || 0;
    if (t.totalAttempts > 0) {
      t.avgResponseMs = Math.round(t._totalResponseMs / t.totalAttempts);
    }

    const entry = {
      requestId,
      targetId,
      status: 'failure',
      error: error?.message || String(error),
      statusCode: error?.statusCode,
      durationMs,
      timestamp: new Date().toISOString(),
    };

    this._addActivity(entry);
    this.recentFailures.unshift(entry);
    if (this.recentFailures.length > 50) this.recentFailures.pop();
  }

  _addActivity(entry) {
    this.recentActivity.unshift(entry);
    if (this.recentActivity.length > 100) this.recentActivity.pop();
  }

  getSummary() {
    if (db.isEnabled()) return db.getStatsSummary();
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    return {
      uptime: `${uptime}s`,
      startTime: this.startTime.toISOString(),
      totalReceived: this.totalReceived,
      targets: Object.values(this.targets),
      recentFailures: this.recentFailures.slice(0, 20),
      recentActivity: this.recentActivity.slice(0, 20),
    };
  }

  reset() {
    if (db.isEnabled()) return db.resetStats();
    this.totalReceived = 0;
    this.targets = {};
    this.recentFailures = [];
    this.recentActivity = [];
    this.startTime = new Date();
  }
}

module.exports = new StatsStore();
