/**
 * Retry queue with exponential backoff
 * Schedules failed deliveries for re-attempt and routes exhausted entries to the DLQ
 */
const { logger } = require('../middleware/logger');
const dlq = require('../store/deadLetterQueue');
const config = require('../config');

class RetryQueue {
  constructor() {
    // Active timers: Map<timerId, { targetId, requestId }>
    this._timers = new Map();
    this._pendingCount = 0;
  }

  /**
   * Schedule a delivery attempt for retry.
   *
   * @param {Object} params
   * @param {string}   params.requestId
   * @param {Object}   params.target       - full target config object
   * @param {*}        params.payload      - body to forward
   * @param {Object}   params.headers      - original request headers
   * @param {string}   params.receivedAt
   * @param {number}   params.attempt      - current attempt index (0-based)
   * @param {string}   params.lastError    - last error message
   * @param {Function} params.deliverFn    - async fn(target, payload, headers) -> void
   */
  async schedule(params) {
    const { requestId, target, payload, headers, receivedAt, attempt, lastError, deliverFn } = params;
    const { maxAttempts, delays } = config.retry;

    if (attempt >= maxAttempts) {
      logger.warn('dlq_push', { requestId, targetId: target.id, attempts: attempt, lastError });
      await dlq.push({
        requestId,
        targetId: target.id,
        targetUrl: target.url,
        payload,
        headers,
        error: lastError,
        attempts: attempt,
        receivedAt,
      });
      return;
    }

    const delayMs = delays[attempt] || delays[delays.length - 1];
    logger.info('retry_scheduled', { requestId, targetId: target.id, attempt, delayMs });

    this._pendingCount++;
    const timerId = setTimeout(async () => {
      this._timers.delete(timerId);
      this._pendingCount--;
      const start = Date.now();
      try {
        await deliverFn(target, payload, headers, requestId);
        logger.info('retry_success', { requestId, targetId: target.id, attempt });
      } catch (err) {
        logger.warn('retry_failed', { requestId, targetId: target.id, attempt, error: err.message });
        this.schedule({
          requestId, target, payload, headers, receivedAt,
          attempt: attempt + 1,
          lastError: err.message,
          deliverFn,
        });
      }
    }, delayMs);

    this._timers.set(timerId, { targetId: target.id, requestId });
  }

  get pendingCount() {
    return this._pendingCount;
  }

  /** Cancel all pending retries (used during graceful shutdown) */
  cancelAll() {
    for (const timerId of this._timers.keys()) {
      clearTimeout(timerId);
    }
    this._timers.clear();
    this._pendingCount = 0;
    logger.info('retry_queue_cleared');
  }
}

module.exports = new RetryQueue();
