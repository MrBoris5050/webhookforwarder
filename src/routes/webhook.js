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
 *   GET  /                       - Arkesel USSD query-string callbacks (that path only)
 *   GET  /:requestId             - retrieve a stored webhook
 *   POST /:requestId/replay      - re-forward a previously received webhook
 */
const express = require('express');
const { logger } = require('../middleware/logger');
const { signatureVerifier } = require('../middleware/signatureVerifier');
const { forwardToAllTargets, deliverToTarget } = require('../services/forwarder');
const arkeselUssd = require('../services/arkeselUssd');
const ussdRouter = require('../services/ussdRouter');
const { isArkeselUssd, isLiveEndpoint } = require('../sources');

function currentEndpoint(path) {
  const config = require('../config');
  return config.endpoints.find(e => e.path === path) || { path };
}

function isLivePath(path) {
  return isLiveEndpoint(currentEndpoint(path));
}
const stats = require('../store/stats');
const webhookStore = require('../store/webhookStore');

function resolveTargets(endpointPath, endpointTargets) {
  const config = require('../config');
  const baseTargets = endpointTargets || config.targets;
  return baseTargets.filter(t => {
    if (!t.enabled) return false;
    const assigned = t.endpoints || [];
    // Unchecked "Receive from" means every fire-and-forget source, not live USSD.
    if (assigned.length === 0) return !isLivePath(endpointPath);
    return assigned.includes(endpointPath);
  });
}

function createWebhookRouter(endpointPath, endpointTargets) {
  const router = express.Router();
  const liveMode = () => isLivePath(endpointPath);
  const ussdProtocol = (req) => isArkeselUssd(endpointPath) || arkeselUssd.looksLikeUssd(req);
  const verify = (req, res, next) => (liveMode() ? next() : signatureVerifier(req, res, next));

  /* ── ingest ── receive a new webhook (POST, or GET for live callbacks) */
  async function ingest(req, res) {
    const requestId = req.requestId;
    const receivedAt = new Date().toISOString();
    const useUssd = liveMode() && ussdProtocol(req);
    const body = useUssd ? arkeselUssd.normalizeRequest(req) : req.body;

    await stats.incrementReceived();

    const webhookData = {
      requestId,
      body,
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

    const routedTargets = resolveTargets(endpointPath, endpointTargets);
    const ussdRoute = useUssd ? ussdRouter.classify(body) : null;
    const liveTargets = useUssd
      ? ussdRouter.filterTargets(routedTargets, ussdRoute, body.sessionID)
      : routedTargets;

    // Live sources wait for a target and return that response to the caller.
    if (liveMode()) {
      const started = Date.now();
      let targetBody = null;
      let outcomes = [];
      try {
        const results = await Promise.allSettled(
          liveTargets.map(t => deliverToTarget(t, body, req.headers, requestId))
        );
        const picked = useUssd
          ? ussdRouter.pickResponse(results, liveTargets, ussdRoute)
          : {
            body: results.find(r => r.status === 'fulfilled' && r.value?.success)?.value?.body ?? null,
            targetId: null,
          };
        targetBody = picked.body;
        if (useUssd && body.sessionID && (ussdRoute || picked.targetId)) {
          ussdRouter.remember(body.sessionID, ussdRoute || 'parent', picked.targetId);
        }
        outcomes = results.map((r, i) => ({
          targetId: liveTargets[i]?.id,
          status: r.status === 'fulfilled' && r.value?.success ? 'success' : 'failed',
          error: r.status === 'rejected' ? r.reason?.message : (r.value?.success ? undefined : `HTTP ${r.value?.status}`),
        }));
        logger.info('forward_complete', {
          requestId,
          endpoint: endpointPath,
          mode: useUssd ? 'arkesel-ussd' : 'live',
          outcomes,
        });
      } catch (err) {
        logger.error('forward_unexpected_error', { requestId, endpoint: endpointPath, error: err.message, stack: err.stack });
      }

      const response = useUssd
        ? arkeselUssd.buildResponse(body, targetBody)
        : (targetBody ?? { error: 'Service temporarily unavailable. Please try again.' });
      const durationMs = Date.now() - started;
      webhookData.response = response;
      webhookData.liveOutcomes = outcomes;
      webhookData.liveFallback = !targetBody;
      await webhookStore.save(requestId, webhookData);

      logger.info('live_response', {
        requestId,
        endpoint: endpointPath,
        fallback: !targetBody,
        targets: liveTargets.length,
        ussdRoute,
        durationMs,
        ...(useUssd ? {
          sessionID: body.sessionID,
          msisdn: body.msisdn,
          userData: body.userData,
          continueSession: response.continueSession,
          message: response.message,
        } : {}),
      });

      if (!targetBody) {
        await stats.recordFailure(
          `live:${endpointPath}`,
          requestId,
          { message: liveTargets.length ? 'No live target response' : 'No live target assigned' },
          durationMs,
        );
      }

      return res.status(200).json(response);
    }

    res.status(202).json({
      accepted: true,
      requestId,
      receivedAt,
      endpoint: endpointPath,
      targets: routedTargets.length,
    });

    try {
      const outcomes = await forwardToAllTargets(webhookData, routedTargets);
      logger.info('forward_complete', { requestId, endpoint: endpointPath, outcomes });
    } catch (err) {
      logger.error('forward_unexpected_error', { requestId, endpoint: endpointPath, error: err.message, stack: err.stack });
    }
  }

  router.post('/', verify, ingest);
  if (liveMode()) router.get('/', ingest);

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
      const replayPath = entry.endpointPath || endpointPath;
      const routedTargets = resolveTargets(replayPath, endpointTargets);
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
