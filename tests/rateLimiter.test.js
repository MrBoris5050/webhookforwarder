/**
 * Tests for the token-bucket rate limiter
 */

// We test the RateLimiterService by creating a fresh instance each time
// to avoid cross-test state pollution from the singleton.

const { RateLimiterService } = require('../src/services/rateLimiter');

describe('RateLimiterService', () => {
  it('allows requests when no rateLimit is configured', () => {
    const svc = new RateLimiterService();
    const target = { id: 't1', rateLimit: null };
    const result = svc.check(target);
    expect(result.allowed).toBe(true);
    expect(result.waitMs).toBe(0);
  });

  it('allows requests within the rate limit', () => {
    const svc = new RateLimiterService();
    const target = { id: 't1', rateLimit: { requestsPerSecond: 10 } };
    for (let i = 0; i < 10; i++) {
      expect(svc.check(target).allowed).toBe(true);
    }
  });

  it('rejects requests that exceed the rate limit', () => {
    const svc = new RateLimiterService();
    const target = { id: 't1', rateLimit: { requestsPerSecond: 2 } };
    svc.check(target); // 1
    svc.check(target); // 2
    const result = svc.check(target); // 3 — should be denied
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
  });

  it('supports requestsPerMinute config', () => {
    const svc = new RateLimiterService();
    const target = { id: 't1', rateLimit: { requestsPerMinute: 1 } };
    expect(svc.check(target).allowed).toBe(true);
    expect(svc.check(target).allowed).toBe(false);
  });

  it('reuses the same bucket for the same target', () => {
    const svc = new RateLimiterService();
    const target = { id: 't1', rateLimit: { requestsPerSecond: 2 } };
    svc.check(target); // 1
    svc.check(target); // 2 — bucket now empty
    // Same target id — should still be denied (same bucket)
    const result = svc.check(target);
    expect(result.allowed).toBe(false);
  });
});
