/**
 * Core webhook forwarding service
 * Handles authentication headers, payload transformation, rate limiting,
 * and delegates retries/DLQ to the retry queue.
 */
const axios = require('axios');
const config = require('../config');
const { logger } = require('../middleware/logger');
const stats = require('../store/stats');
const retryQueue = require('./retryQueue');
const rateLimiter = require('./rateLimiter');
const { applyTransform } = require('./transformer');

/**
 * Build authorization header value for a target based on its auth config.
 *
 * Supported auth types:
 *   { type: 'bearer', token: '...' }
 *   { type: 'apikey', header: 'X-Api-Key', value: '...' }
 *   { type: 'basic', username: '...', password: '...' }
 */
function buildAuthHeaders(auth) {
  if (!auth) return {};

  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.token}` };

    case 'apikey':
      return { [auth.header || 'X-Api-Key']: auth.value };

    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }

    default:
      logger.warn('unknown_auth_type', { type: auth.type });
      return {};
  }
}

/**
 * Select which incoming headers to forward to targets.
 * Strips hop-by-hop and host headers; always forwards content-type.
 */
function filterIncomingHeaders(rawHeaders) {
  const skip = new Set([
    'host', 'connection', 'transfer-encoding', 'te', 'trailer',
    'proxy-authorization', 'proxy-authenticate', 'upgrade', 'keep-alive',
    'content-length', // axios recalculates
  ]);
  const result = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (!skip.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Deliver a payload to a single target.
 * Throws on HTTP errors or network failures so callers can handle retries.
 *
 * @param {Object} target
 * @param {*}      payload         - transformed body
 * @param {Object} incomingHeaders - original request headers
 * @param {string} requestId
 */
async function deliverToTarget(target, payload, incomingHeaders, requestId) {
  stats.initTarget(target.id);

  const { allowed, waitMs } = rateLimiter.check(target);
  if (!allowed) {
    const err = new Error(`Rate limit exceeded for target ${target.id}; retry in ${waitMs}ms`);
    err.statusCode = 429;
    throw err;
  }

  const transformed = applyTransform(target.transform, payload);

  const headers = {
    ...filterIncomingHeaders(incomingHeaders),
    ...target.headers,
    ...buildAuthHeaders(target.auth),
    'x-forwarded-by': 'webhook-forwarder',
    'x-request-id': requestId,
  };

  const start = Date.now();
  try {
    const response = await axios({
      method: 'POST',
      url: target.url,
      data: transformed,
      headers,
      timeout: config.timeout,
      validateStatus: status => status < 500, // treat 4xx as success to avoid infinite retries on bad auth
    });

    const duration = Date.now() - start;

    if (response.status >= 400) {
      // 4xx from the target — log but do NOT retry (likely a config error)
      logger.warn('target_4xx', {
        requestId,
        targetId: target.id,
        status: response.status,
        durationMs: duration,
      });
      await stats.recordFailure(target.id, requestId, { message: `HTTP ${response.status}`, statusCode: response.status }, duration);
      return { success: false, status: response.status };
    }

    logger.info('target_success', { requestId, targetId: target.id, status: response.status, durationMs: duration });
    await stats.recordSuccess(target.id, requestId, duration);
    return { success: true, status: response.status };

  } catch (err) {
    const duration = Date.now() - start;
    // Network errors, timeouts, and 5xx (after validateStatus=false)
    const message = err.code === 'ECONNABORTED' ? 'Request timed out' : err.message;
    logger.warn('target_error', { requestId, targetId: target.id, error: message, durationMs: duration });
    await stats.recordFailure(target.id, requestId, { message, statusCode: err.response?.status }, duration);

    const forwardErr = new Error(message);
    forwardErr.statusCode = err.response?.status;
    throw forwardErr;
  }
}

/**
 * Forward a webhook to all enabled targets concurrently.
 * Uses Promise.allSettled so a failure on one target does not block others.
 *
 * @param {Object} webhookData
 * @param {string} webhookData.requestId
 * @param {*}      webhookData.body
 * @param {Object} webhookData.headers
 * @param {string} webhookData.receivedAt
 * @returns {Promise<Array<{targetId, status, reason}>>}
 */
async function forwardToAllTargets({ requestId, body, headers, receivedAt }) {
  const enabledTargets = config.targets.filter(t => t.enabled);

  if (enabledTargets.length === 0) {
    logger.warn('no_targets_configured', { requestId });
    return [];
  }

  const results = await Promise.allSettled(
    enabledTargets.map(target =>
      deliverToTarget(target, body, headers, requestId)
    )
  );

  const outcomes = results.map((result, i) => {
    const target = enabledTargets[i];
    if (result.status === 'fulfilled') {
      return { targetId: target.id, status: 'success', httpStatus: result.value?.status };
    }

    // Delivery failed — schedule for retry
    retryQueue.schedule({
      requestId,
      target,
      payload: body,
      headers,
      receivedAt,
      attempt: 0,
      lastError: result.reason?.message,
      deliverFn: deliverToTarget,
    });

    return {
      targetId: target.id,
      status: 'queued_for_retry',
      error: result.reason?.message,
    };
  });

  return outcomes;
}

module.exports = { forwardToAllTargets, deliverToTarget, buildAuthHeaders, filterIncomingHeaders };
