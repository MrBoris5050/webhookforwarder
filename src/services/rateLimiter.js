/**
 * Per-target in-memory rate limiter using a token bucket algorithm.
 *
 * Each target can define a rateLimit config:
 *   { "requestsPerSecond": 5 }
 * or
 *   { "requestsPerMinute": 60 }
 *
 * If no rateLimit is defined for a target, forwarding is unlimited.
 */

class TokenBucket {
  /**
   * @param {number} capacity      - max tokens in bucket
   * @param {number} refillRateMs  - tokens added per millisecond
   */
  constructor(capacity, refillRateMs) {
    this.capacity = capacity;
    this.refillRateMs = refillRateMs; // tokens/ms
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const added = elapsed * this.refillRateMs;
    this.tokens = Math.min(this.capacity, this.tokens + added);
    this.lastRefill = now;
  }

  /** Returns true if a token was consumed, false if the bucket is empty */
  consume() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds to wait before the next token is available */
  nextTokenMs() {
    this._refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRateMs);
  }
}

class RateLimiterService {
  constructor() {
    this.buckets = new Map(); // targetId -> TokenBucket
  }

  _getBucket(target) {
    if (this.buckets.has(target.id)) return this.buckets.get(target.id);

    const rl = target.rateLimit;
    if (!rl) return null;

    let capacity, refillRateMs;
    if (rl.requestsPerSecond) {
      capacity = rl.requestsPerSecond;
      refillRateMs = rl.requestsPerSecond / 1000;
    } else if (rl.requestsPerMinute) {
      capacity = rl.requestsPerMinute;
      refillRateMs = rl.requestsPerMinute / 60000;
    } else {
      return null;
    }

    const bucket = new TokenBucket(capacity, refillRateMs);
    this.buckets.set(target.id, bucket);
    return bucket;
  }

  /**
   * Check if a request to this target is allowed.
   * @returns {{ allowed: boolean, waitMs: number }}
   */
  check(target) {
    const bucket = this._getBucket(target);
    if (!bucket) return { allowed: true, waitMs: 0 };

    const allowed = bucket.consume();
    const waitMs = allowed ? 0 : bucket.nextTokenMs();
    return { allowed, waitMs };
  }
}

const instance = new RateLimiterService();
instance.RateLimiterService = RateLimiterService; // expose class for testing
module.exports = instance;
