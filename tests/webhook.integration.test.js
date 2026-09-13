/**
 * Integration tests for the webhook endpoint
 * Uses nock to intercept outbound HTTP calls and supertest for inbound
 */
const request = require('supertest');
const nock = require('nock');

// Override config before requiring app
process.env.TARGET_URLS = 'http://target1.example.com/hook,http://target2.example.com/hook';
process.env.ADMIN_AUTH_REQUIRED = 'false';
process.env.SIGNATURE_VERIFY = 'false';
process.env.LOG_LEVEL = 'silent';

// Silence logger in tests
jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

let app;

beforeAll(() => {
  // Disable real HTTP connections
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
  app = require('../src/app')();
});

afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

describe('POST /webhook', () => {
  it('responds 202 Accepted immediately', async () => {
    nock('http://target1.example.com').post('/hook').reply(200);
    nock('http://target2.example.com').post('/hook').reply(200);

    const res = await request(app)
      .post('/webhook')
      .send({ event: 'test' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.receivedAt).toBeDefined();
  });

  it('includes x-request-id in response headers', async () => {
    nock('http://target1.example.com').post('/hook').reply(200);
    nock('http://target2.example.com').post('/hook').reply(200);

    const res = await request(app)
      .post('/webhook')
      .send({ event: 'test' });

    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('uses client-provided x-request-id when present', async () => {
    nock('http://target1.example.com').post('/hook').reply(200);
    nock('http://target2.example.com').post('/hook').reply(200);

    const res = await request(app)
      .post('/webhook')
      .set('x-request-id', 'my-custom-id')
      .send({ event: 'test' });

    expect(res.headers['x-request-id']).toBe('my-custom-id');
  });
});

describe('GET /health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.targets).toBeDefined();
  });
});

describe('GET /admin/stats', () => {
  it('returns stats without auth when auth is disabled', async () => {
    const res = await request(app).get('/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.totalReceived).toBeDefined();
  });
});

describe('POST /webhook/arkesel-ussd', () => {
  let previousEndpoints;

  beforeAll(() => {
    const cfg = require('../src/config');
    previousEndpoints = cfg.targets.map(t => t.endpoints);
    cfg.targets.forEach(t => { t.endpoints = ['/webhook/arkesel-ussd']; });
  });

  afterAll(() => {
    const cfg = require('../src/config');
    cfg.targets.forEach((t, i) => { t.endpoints = previousEndpoints[i]; });
  });

  const ussdPayload = {
    sessionID: '2005506191900168',
    userID: 'USSD_DOCUMENTATION',
    newSession: true,
    msisdn: '233271231234',
    userData: '*928*1#',
    network: 'AIRTELTIGO',
  };

  it('returns Arkesel USSD JSON from the first successful target', async () => {
    nock('http://target1.example.com').post('/hook').reply(200, {
      sessionID: ussdPayload.sessionID,
      userID: ussdPayload.userID,
      msisdn: ussdPayload.msisdn,
      message: 'Welcome to MyApp',
      continueSession: true,
    });
    nock('http://target2.example.com').post('/hook').reply(200, { ok: true });

    const res = await request(app)
      .post('/webhook/arkesel-ussd')
      .send(ussdPayload)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionID: ussdPayload.sessionID,
      userID: ussdPayload.userID,
      msisdn: ussdPayload.msisdn,
      message: 'Welcome to MyApp',
      continueSession: true,
    });
  });

  it('returns a fallback END menu when no target answers', async () => {
    nock('http://target1.example.com').post('/hook').reply(500);
    nock('http://target2.example.com').post('/hook').reply(500);

    const res = await request(app)
      .post('/webhook/arkesel-ussd')
      .send(ussdPayload);

    expect(res.status).toBe(200);
    expect(res.body.sessionID).toBe(ussdPayload.sessionID);
    expect(res.body.continueSession).toBe(false);
    expect(res.body.message).toMatch(/unavailable/i);
  });

  it('stores a request/response transcript', async () => {
    nock('http://target1.example.com').post('/hook').reply(200, {
      message: 'Pick an option',
      continueSession: true,
    });
    nock('http://target2.example.com').post('/hook').reply(200, { ok: true });

    const res = await request(app)
      .post('/webhook/arkesel-ussd')
      .send(ussdPayload);

    const stored = await request(app).get(`/admin/webhooks/${res.headers['x-request-id']}`);
    expect(stored.status).toBe(200);
    expect(stored.body.body).toMatchObject({
      sessionID: ussdPayload.sessionID,
      userData: ussdPayload.userData,
    });
    expect(stored.body.response).toEqual({
      sessionID: ussdPayload.sessionID,
      userID: ussdPayload.userID,
      msisdn: ussdPayload.msisdn,
      message: 'Pick an option',
      continueSession: true,
    });
    expect(stored.body.liveFallback).toBe(false);
  });
});

describe('Webhook replay', () => {
  it('can retrieve a stored webhook by requestId', async () => {
    nock('http://target1.example.com').post('/hook').reply(200);
    nock('http://target2.example.com').post('/hook').reply(200);

    const postRes = await request(app)
      .post('/webhook')
      .send({ event: 'stored' });

    const requestId = postRes.body.requestId;

    // Small wait to ensure the async forwarding started
    await new Promise(r => setTimeout(r, 50));

    const getRes = await request(app).get(`/webhook/${requestId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.requestId).toBe(requestId);
  });

  it('returns 404 for unknown requestId', async () => {
    const res = await request(app).get('/webhook/does-not-exist');
    expect(res.status).toBe(404);
  });
});
