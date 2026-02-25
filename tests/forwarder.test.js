/**
 * Tests for the core forwarding service
 * Uses nock to intercept HTTP requests without real network calls
 */
const nock = require('nock');
const { buildAuthHeaders, filterIncomingHeaders } = require('../src/services/forwarder');

// ── buildAuthHeaders ─────────────────────────────────────────────

describe('buildAuthHeaders', () => {
  it('returns empty object for null auth', () => {
    expect(buildAuthHeaders(null)).toEqual({});
    expect(buildAuthHeaders(undefined)).toEqual({});
  });

  it('generates Bearer token header', () => {
    const headers = buildAuthHeaders({ type: 'bearer', token: 'abc123' });
    expect(headers).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('generates API key header with custom key name', () => {
    const headers = buildAuthHeaders({ type: 'apikey', header: 'X-Api-Key', value: 'secret' });
    expect(headers).toEqual({ 'X-Api-Key': 'secret' });
  });

  it('uses default X-Api-Key header name when not specified', () => {
    const headers = buildAuthHeaders({ type: 'apikey', value: 'secret' });
    expect(headers).toEqual({ 'X-Api-Key': 'secret' });
  });

  it('generates Basic auth header', () => {
    const headers = buildAuthHeaders({ type: 'basic', username: 'user', password: 'pass' });
    const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
    expect(headers).toEqual({ Authorization: expected });
  });

  it('returns empty object for unknown auth type', () => {
    const headers = buildAuthHeaders({ type: 'unknown' });
    expect(headers).toEqual({});
  });
});

// ── filterIncomingHeaders ────────────────────────────────────────

describe('filterIncomingHeaders', () => {
  it('strips hop-by-hop headers', () => {
    const raw = {
      'host': 'example.com',
      'connection': 'keep-alive',
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
      'x-custom': 'value',
    };
    const filtered = filterIncomingHeaders(raw);
    expect(filtered).not.toHaveProperty('host');
    expect(filtered).not.toHaveProperty('connection');
    expect(filtered).not.toHaveProperty('transfer-encoding');
  });

  it('preserves content-type and custom headers', () => {
    const raw = {
      'content-type': 'application/json',
      'x-custom-header': 'value',
      'x-github-event': 'push',
    };
    const filtered = filterIncomingHeaders(raw);
    expect(filtered['content-type']).toBe('application/json');
    expect(filtered['x-custom-header']).toBe('value');
    expect(filtered['x-github-event']).toBe('push');
  });

  it('strips content-length (axios will recalculate)', () => {
    const raw = { 'content-length': '42', 'content-type': 'application/json' };
    const filtered = filterIncomingHeaders(raw);
    expect(filtered).not.toHaveProperty('content-length');
  });
});
