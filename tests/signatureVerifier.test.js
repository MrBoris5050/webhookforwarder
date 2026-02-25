/**
 * Tests for HMAC signature verification
 */
const { computeSignature } = require('../src/middleware/signatureVerifier');
const crypto = require('crypto');

describe('computeSignature', () => {
  const secret = 'my-webhook-secret';
  const body = Buffer.from('{"event":"push"}');

  it('generates a sha256 HMAC with algorithm prefix', () => {
    const sig = computeSignature(body, secret, 'sha256');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('matches manual HMAC computation', () => {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(computeSignature(body, secret, 'sha256')).toBe(expected);
  });

  it('produces different signatures for different secrets', () => {
    const sig1 = computeSignature(body, 'secret-1', 'sha256');
    const sig2 = computeSignature(body, 'secret-2', 'sha256');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different payloads', () => {
    const sig1 = computeSignature(Buffer.from('body-1'), secret, 'sha256');
    const sig2 = computeSignature(Buffer.from('body-2'), secret, 'sha256');
    expect(sig1).not.toBe(sig2);
  });

  it('uses the specified algorithm prefix', () => {
    const sig = computeSignature(body, secret, 'sha1');
    expect(sig).toMatch(/^sha1=/);
  });
});
