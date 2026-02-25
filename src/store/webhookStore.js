/**
 * In-memory webhook store for replay capability
 * When MONGODB_URI is set, uses MongoDB instead (async).
 */
const config = require('../config');
const db = require('./db');

class WebhookStore {
  constructor(maxSize) {
    this.maxSize = maxSize || 200;
    this.store = new Map();
    this.order = [];
  }

  async save(requestId, data) {
    if (db.isEnabled()) {
      await db.saveWebhook(requestId, data);
      return;
    }
    if (this.order.length >= this.maxSize) {
      const oldest = this.order.shift();
      this.store.delete(oldest);
    }
    this.store.set(requestId, {
      ...data,
      savedAt: new Date().toISOString(),
    });
    this.order.push(requestId);
  }

  async get(requestId) {
    if (db.isEnabled()) return db.getWebhook(requestId);
    return this.store.get(requestId) || null;
  }

  async list(limit = 50, offset = 0) {
    if (db.isEnabled()) return db.listWebhooks(limit, offset);
    const ids = this.order.slice().reverse();
    return ids.slice(offset, offset + limit).map(id => this.store.get(id));
  }

  async count() {
    if (db.isEnabled()) return db.countWebhooks();
    return this.store.size;
  }

  async clear() {
    if (db.isEnabled()) {
      await db.clearWebhooks();
      return;
    }
    this.store.clear();
    this.order = [];
  }
}

module.exports = new WebhookStore(config.store.maxWebhooks);
