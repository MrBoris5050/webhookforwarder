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
