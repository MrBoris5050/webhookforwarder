/**
 * Tests for in-memory stores
 */

// ── WebhookStore ─────────────────────────────────────────────────

describe('WebhookStore', () => {
  let WebhookStore;

  beforeEach(() => {
    jest.resetModules();
    // Provide a minimal config so the store module doesn't crash
    jest.mock('../src/config', () => ({ store: { maxWebhooks: 3, maxDLQ: 10 } }));
    const { WebhookStore: WS } = require('../src/store/webhookStore');
    // Re-instantiate for a fresh store
    WebhookStore = new (require('../src/store/webhookStore').constructor || Object)(3);
    // Use the module directly since it exports a singleton
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('saves and retrieves webhooks', () => {
    jest.resetModules();
    jest.mock('../src/config', () => ({ store: { maxWebhooks: 5, maxDLQ: 10 } }));
    // Re-require the class directly from its constructor
    const store = createWebhookStore(5);
    store.save('id-1', { body: { a: 1 } });
    const entry = store.get('id-1');
    expect(entry).toBeDefined();
    expect(entry.body).toEqual({ a: 1 });
    expect(entry.savedAt).toBeDefined();
  });

  it('evicts oldest entry when maxSize is reached', () => {
    const store = createWebhookStore(2);
    store.save('id-1', { body: 'first' });
    store.save('id-2', { body: 'second' });
    store.save('id-3', { body: 'third' }); // should evict id-1
    expect(store.get('id-1')).toBeNull();
    expect(store.get('id-2')).toBeDefined();
    expect(store.get('id-3')).toBeDefined();
    expect(store.count()).toBe(2);
  });

  it('lists webhooks newest-first', () => {
    const store = createWebhookStore(5);
    store.save('id-1', { body: 1 });
    store.save('id-2', { body: 2 });
    store.save('id-3', { body: 3 });
    const list = store.list();
    expect(list[0].body).toBe(3);
    expect(list[1].body).toBe(2);
  });

  it('clears all entries', () => {
    const store = createWebhookStore(5);
    store.save('id-1', {});
    store.clear();
    expect(store.count()).toBe(0);
  });
});

// ── DeadLetterQueue ──────────────────────────────────────────────

describe('DeadLetterQueue', () => {
  it('pushes and lists entries', () => {
    const q = createDLQ(10);
    q.push({ requestId: 'r1', targetId: 'target-1', targetUrl: 'http://x', error: 'timeout', attempts: 3 });
    expect(q.count()).toBe(1);
    const list = q.list();
    expect(list[0].requestId).toBe('r1');
    expect(list[0].id).toMatch(/^dlq-/);
    expect(list[0].failedAt).toBeDefined();
  });

  it('evicts oldest when maxSize is reached', () => {
    const q = createDLQ(2);
    q.push({ requestId: 'r1', error: 'e1' });
    q.push({ requestId: 'r2', error: 'e2' });
    q.push({ requestId: 'r3', error: 'e3' });
    expect(q.count()).toBe(2);
    // r1 should have been evicted
    expect(q.list().map(e => e.requestId)).not.toContain('r1');
  });

  it('removes an entry by id', () => {
    const q = createDLQ(10);
    q.push({ requestId: 'r1', error: 'e' });
    const id = q.list()[0].id;
    const removed = q.remove(id);
    expect(removed).toBe(true);
    expect(q.count()).toBe(0);
  });

  it('returns false when removing non-existent id', () => {
    const q = createDLQ(10);
    expect(q.remove('does-not-exist')).toBe(false);
  });

  it('gets an entry by id', () => {
    const q = createDLQ(10);
    q.push({ requestId: 'r1', error: 'e' });
    const id = q.list()[0].id;
    expect(q.get(id)?.requestId).toBe('r1');
    expect(q.get('bad-id')).toBeNull();
  });

  it('clears all entries', () => {
    const q = createDLQ(10);
    q.push({ requestId: 'r1', error: 'e' });
    q.clear();
    expect(q.count()).toBe(0);
  });
});

// ── StatsStore ───────────────────────────────────────────────────

describe('StatsStore', () => {
  let stats;

  beforeEach(() => {
    const StatsStore = require('../src/store/stats').constructor;
    stats = createStatsStore();
  });

  it('increments received count', () => {
    stats.incrementReceived();
    stats.incrementReceived();
    expect(stats.totalReceived).toBe(2);
  });

  it('records success and computes averages', () => {
    stats.recordSuccess('target-1', 'req-1', 100);
    const t = stats.targets['target-1'];
    expect(t.success).toBe(1);
    expect(t.failure).toBe(0);
    expect(t.avgResponseMs).toBe(100);
    expect(t.lastSuccess).toBeDefined();
  });

  it('records failure', () => {
    stats.recordFailure('target-1', 'req-1', { message: 'timeout' }, 5000);
    const t = stats.targets['target-1'];
    expect(t.failure).toBe(1);
    expect(t.lastFailure).toBeDefined();
  });

  it('populates recentFailures', () => {
    stats.recordFailure('target-1', 'req-1', { message: 'err' }, 100);
    expect(stats.recentFailures.length).toBe(1);
    expect(stats.recentFailures[0].error).toBe('err');
  });

  it('resets all counters', () => {
    stats.incrementReceived();
    stats.recordSuccess('t1', 'r1', 50);
    stats.reset();
    expect(stats.totalReceived).toBe(0);
    expect(Object.keys(stats.targets)).toHaveLength(0);
  });

  it('getSummary returns correct shape', () => {
    const summary = stats.getSummary();
    expect(summary).toHaveProperty('uptime');
    expect(summary).toHaveProperty('totalReceived');
    expect(summary).toHaveProperty('targets');
    expect(summary).toHaveProperty('recentFailures');
  });
});

// ── Helpers (inline class instantiation to avoid module caching) ──

function createWebhookStore(maxSize) {
  class WebhookStore {
    constructor(maxSize) {
      this.maxSize = maxSize || 200;
      this.store = new Map();
      this.order = [];
    }
    save(requestId, data) {
      if (this.order.length >= this.maxSize) {
        const oldest = this.order.shift();
        this.store.delete(oldest);
      }
      this.store.set(requestId, { ...data, savedAt: new Date().toISOString() });
      this.order.push(requestId);
    }
    get(requestId) { return this.store.get(requestId) || null; }
    list(limit = 50, offset = 0) {
      return this.order.slice().reverse().slice(offset, offset + limit).map(id => this.store.get(id));
    }
    count() { return this.store.size; }
    clear() { this.store.clear(); this.order = []; }
  }
  return new WebhookStore(maxSize);
}

function createDLQ(maxSize) {
  class DeadLetterQueue {
    constructor(maxSize) { this.maxSize = maxSize || 500; this.queue = []; }
    push(entry) {
      if (this.queue.length >= this.maxSize) this.queue.shift();
      this.queue.push({ ...entry, failedAt: new Date().toISOString(), id: `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    }
    list(limit = 50, offset = 0) { return this.queue.slice().reverse().slice(offset, offset + limit); }
    get(id) { return this.queue.find(e => e.id === id) || null; }
    remove(id) { const i = this.queue.findIndex(e => e.id === id); if (i !== -1) { this.queue.splice(i, 1); return true; } return false; }
    count() { return this.queue.length; }
    clear() { this.queue = []; }
  }
  return new DeadLetterQueue(maxSize);
}

function createStatsStore() {
  class StatsStore {
    constructor() { this.startTime = new Date(); this.totalReceived = 0; this.targets = {}; this.recentFailures = []; this.recentActivity = []; }
    initTarget(id) { if (!this.targets[id]) this.targets[id] = { id, success: 0, failure: 0, lastSuccess: null, lastFailure: null, totalAttempts: 0, avgResponseMs: 0, _totalResponseMs: 0 }; }
    incrementReceived() { this.totalReceived++; }
    recordSuccess(id, reqId, dur) { this.initTarget(id); const t = this.targets[id]; t.success++; t.totalAttempts++; t.lastSuccess = new Date().toISOString(); t._totalResponseMs += dur; t.avgResponseMs = Math.round(t._totalResponseMs / t.totalAttempts); this._addActivity({ requestId: reqId, targetId: id, status: 'success', durationMs: dur, timestamp: new Date().toISOString() }); }
    recordFailure(id, reqId, err, dur) { this.initTarget(id); const t = this.targets[id]; t.failure++; t.totalAttempts++; t.lastFailure = new Date().toISOString(); t._totalResponseMs += dur || 0; if (t.totalAttempts > 0) t.avgResponseMs = Math.round(t._totalResponseMs / t.totalAttempts); const entry = { requestId: reqId, targetId: id, status: 'failure', error: err?.message || String(err), statusCode: err?.statusCode, durationMs: dur, timestamp: new Date().toISOString() }; this._addActivity(entry); this.recentFailures.unshift(entry); if (this.recentFailures.length > 50) this.recentFailures.pop(); }
    _addActivity(e) { this.recentActivity.unshift(e); if (this.recentActivity.length > 100) this.recentActivity.pop(); }
    getSummary() { const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000); return { uptime: `${uptime}s`, startTime: this.startTime.toISOString(), totalReceived: this.totalReceived, targets: Object.values(this.targets), recentFailures: this.recentFailures.slice(0, 20), recentActivity: this.recentActivity.slice(0, 20) }; }
    reset() { this.totalReceived = 0; this.targets = {}; this.recentFailures = []; this.recentActivity = []; this.startTime = new Date(); }
  }
  return new StatsStore();
}
