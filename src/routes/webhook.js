/**
 * Webhook ingestion endpoint
 * POST /webhook  (path configurable via WEBHOOK_PATH env var)
 */
const express = require('express');
const { logger } = require('../middleware/logger');
const { signatureVerifier } = require('../middleware/signatureVerifier');
const { forwardToAllTargets } = require('../services/forwarder');
const stats = require('../store/stats');
const webhookStore = require('../store/webhookStore');

const router = express.Router();

router.post('/', signatureVerifier, async (req, res) => {
  const requestId = req.requestId;
  const receivedAt = new Date().toISOString();

  // Basic input validation
  await stats.incrementReceived();

  const webhookData = {
    requestId,
    body: req.body,
    headers: req.headers,
    receivedAt,
    method: req.method,
    query: req.query,
  };

  // Persist for replay
  await webhookStore.save(requestId, webhookData);

  logger.info('webhook_received', {
    requestId,
    receivedAt,
    contentType: req.headers['content-type'],
    bodySize: req.headers['content-length'],
  });

  // Respond immediately so the sender isn't kept waiting
  res.status(202).json({
    accepted: true,
    requestId,
    receivedAt,
    targets: (require('../config').targets.filter(t => t.enabled)).length,
  });

  // Forward asynchronously after responding
  try {
    const outcomes = await forwardToAllTargets(webhookData);
    logger.info('forward_complete', { requestId, outcomes });
  } catch (err) {
    logger.error('forward_unexpected_error', { requestId, error: err.message, stack: err.stack });
  }
});

/**
 * GET /webhook/:requestId  - retrieve a stored webhook for replay
 */
router.get('/:requestId', async (req, res) => {
  const entry = await webhookStore.get(req.params.requestId);
  if (!entry) return res.status(404).json({ error: 'Webhook not found' });
  res.json(entry);
});

/**
 * POST /webhook/:requestId/replay  - re-forward a previously received webhook
 */
router.post('/:requestId/replay', async (req, res) => {
  const entry = await webhookStore.get(req.params.requestId);
  if (!entry) return res.status(404).json({ error: 'Webhook not found' });

  logger.info('webhook_replay', { requestId: req.requestId, replayOf: entry.requestId });
  await stats.incrementReceived();

  res.status(202).json({ accepted: true, requestId: req.requestId, replayOf: entry.requestId });

  try {
    const outcomes = await forwardToAllTargets({
      ...entry,
      requestId: req.requestId, // new ID for the replay attempt
    });
    logger.info('replay_complete', { requestId: req.requestId, outcomes });
  } catch (err) {
    logger.error('replay_error', { requestId: req.requestId, error: err.message });
  }
});

module.exports = router;
