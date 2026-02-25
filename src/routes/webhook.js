/**
 * Webhook ingestion endpoint factory.
 *
 * createWebhookRouter(endpointPath, endpointTargets)
 *   endpointPath    - the mount path (e.g. "/webhook", "/webhook/jessco")
 *   endpointTargets - optional array of targets specific to this endpoint;
 *                     pass null/undefined to use the global config.targets
 *
 * Each returned router exposes:
 *   POST /                       - receive a new webhook
 *   GET  /:requestId             - retrieve a stored webhook
 *   POST /:requestId/replay      - re-forward a previously received webhook
 */
const express = require('express');
const { logger } = require('../middleware/logger');
const { signatureVerifier } = require('../middleware/signatureVerifier');
const { forwardToAllTargets } = require('../services/forwarder');
const stats = require('../store/stats');
const webhookStore = require('../store/webhookStore');

function createWebhookRouter(endpointPath, endpointTargets) {
  const router = express.Router();

  /* ── POST / ── receive a new webhook ─────────────────────────── */
  router.post('/', signatureVerifier, async (req, res) => {
    const requestId = req.requestId;
    const receivedAt = new Date().toISOString();

    await stats.incrementReceived();

    const webhookData = {
      requestId,
      body: req.body,
      headers: req.headers,
      receivedAt,
      method: req.method,
      query: req.query,
      endpointPath,
    };

    await webhookStore.save(requestId, webhookData);

    logger.info('webhook_received', {
      requestId,
      receivedAt,
      endpoint: endpointPath,
      contentType: req.headers['content-type'],
      bodySize: req.headers['content-length'],
    });

    // Resolve targets for this endpoint:
    //   1. Use per-endpoint override targets if set (from config.json)
    //   2. Otherwise use global targets, filtered to those assigned to this endpoint
    //      (targets with an empty endpoints[] receive from all paths)
    const config = require('../config');
    const baseTargets = endpointTargets || config.targets;
    const routedTargets = baseTargets.filter(t =>
      t.enabled && (!t.endpoints || t.endpoints.length === 0 || t.endpoints.includes(endpointPath))
    );

    res.status(202).json({
      accepted: true,
      requestId,
      receivedAt,
      endpoint: endpointPath,
      targets: routedTargets.length,
    });

    // Forward asynchronously after responding
    try {
      const outcomes = await forwardToAllTargets(webhookData, routedTargets);
      logger.info('forward_complete', { requestId, endpoint: endpointPath, outcomes });
    } catch (err) {
      logger.error('forward_unexpected_error', { requestId, endpoint: endpointPath, error: err.message, stack: err.stack });
    }
  });

  /* ── GET /:requestId ── retrieve a stored webhook ─────────────── */
  router.get('/:requestId', async (req, res) => {
    const entry = await webhookStore.get(req.params.requestId);
    if (!entry) return res.status(404).json({ error: 'Webhook not found' });
    res.json(entry);
  });

  /* ── POST /:requestId/replay ── re-forward a stored webhook ───── */
  router.post('/:requestId/replay', async (req, res) => {
    const entry = await webhookStore.get(req.params.requestId);
    if (!entry) return res.status(404).json({ error: 'Webhook not found' });

    logger.info('webhook_replay', { requestId: req.requestId, replayOf: entry.requestId });
    await stats.incrementReceived();

    res.status(202).json({ accepted: true, requestId: req.requestId, replayOf: entry.requestId });

    try {
      const config = require('../config');
      const baseTargets = endpointTargets || config.targets;
      const replayPath = entry.endpointPath || endpointPath;
      const routedTargets = baseTargets.filter(t =>
        t.enabled && (!t.endpoints || t.endpoints.length === 0 || t.endpoints.includes(replayPath))
      );
      const outcomes = await forwardToAllTargets(
        { ...entry, requestId: req.requestId },
        routedTargets,
      );
      logger.info('replay_complete', { requestId: req.requestId, outcomes });
    } catch (err) {
      logger.error('replay_error', { requestId: req.requestId, error: err.message });
    }
  });

  return router;
}

// ── Router cache ──────────────────────────────────────────────────
// Keyed by endpoint path. Allows the dynamic dispatcher in app.js to
// serve newly-added endpoints without a server restart.
const _routerCache = new Map();

function getRouter(ep) {
  if (!_routerCache.has(ep.path)) {
    _routerCache.set(ep.path, createWebhookRouter(ep.path, ep.targets));
  }
  return _routerCache.get(ep.path);
}

module.exports = { createWebhookRouter, getRouter };
