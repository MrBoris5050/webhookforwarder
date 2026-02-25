/**
 * Dead-letter queue (DLQ) for permanently failed webhook deliveries
 * When MONGODB_URI is set, uses MongoDB instead (async).
 */
const config = require('../config');
const db = require('./db');

class DeadLetterQueue {
  constructor(maxSize) {
    this.maxSize = maxSize || 500;
    this.queue = [];
  }

  async push(entry) {
    if (db.isEnabled()) {
      await db.pushDlq(entry);
      return;
    }
    if (this.queue.length >= this.maxSize) this.queue.shift();
    this.queue.push({
      ...entry,
      failedAt: new Date().toISOString(),
      id: `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
  }

  async list(limit = 50, offset = 0) {
    if (db.isEnabled()) return db.listDlq(limit, offset);
    return this.queue.slice().reverse().slice(offset, offset + limit);
  }

  async get(id) {
    if (db.isEnabled()) return db.getDlq(id);
    return this.queue.find(e => e.id === id) || null;
  }

  async remove(id) {
    if (db.isEnabled()) return db.removeDlq(id);
    const idx = this.queue.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  async count() {
    if (db.isEnabled()) return db.countDlq();
    return this.queue.length;
  }

  async clear() {
    if (db.isEnabled()) {
      await db.clearDlq();
      return;
    }
    this.queue = [];
  }
}

module.exports = new DeadLetterQueue(config.store.maxDLQ);
