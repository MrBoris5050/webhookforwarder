/**
 * Health check endpoint
 * GET /health  -> 200 with uptime, target count, pending retries, DB status
 */
const express = require('express');
const config = require('../config');
const retryQueue = require('../services/retryQueue');
const dlq = require('../store/deadLetterQueue');
const webhookStore = require('../store/webhookStore');
const db = require('../store/db');

const router = express.Router();

router.get('/', async (req, res) => {
  const dlqCount = await dlq.count();
  const webhookCount = await webhookStore.count();

  let database = null;
  if (db.isEnabled()) {
    try {
      await db.ping();
      database = { connected: true };
    } catch (err) {
      database = { connected: false, error: err.message };
    }
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    targets: {
      total: config.targets.length,
      enabled: config.targets.filter(t => t.enabled).length,
    },
    retryQueue: {
      pending: retryQueue.pendingCount,
    },
    deadLetterQueue: {
      count: dlqCount,
    },
    webhookStore: {
      count: webhookCount,
    },
    database,
  });
});

module.exports = router;
