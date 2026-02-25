# Webhook Forwarder

A production-ready webhook relay service that accepts incoming webhooks and fans them out to up to 5 (or more) configurable target platforms — with retry logic, a dead-letter queue, payload transformation, rate limiting, and an admin dashboard.

## Features

| Feature | Details |
|---|---|
| **Multi-target fanout** | Forward each webhook to all enabled targets concurrently via `Promise.allSettled` |
| **Retry with backoff** | 3 automatic retry attempts at 1 s → 3 s → 9 s |
| **Dead-letter queue** | Permanently failed deliveries stored in memory for inspection and manual retry |
| **Webhook replay** | Recent webhooks stored in memory; replay any previously received event |
| **Payload transformation** | `{{placeholder}}` templates per target using values from the original payload |
| **Per-target auth** | Bearer token, API key header, or Basic auth |
| **Rate limiting** | Token-bucket rate limiter per target (`requestsPerSecond` / `requestsPerMinute`) |
| **Signature verification** | HMAC-SHA256 (and other algorithms) for incoming webhook validation |
| **Admin dashboard** | JSON API + HTML dashboard at `/admin/stats` |
| **Health check** | `/health` endpoint with queue and target status |
| **Structured logging** | Winston JSON logs with per-request IDs |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure targets

**Option A — Environment variables (simple)**

```bash
# Copy the example and edit it
cp .env.example .env
```

Edit `.env` and set `TARGET_URLS` to a comma-separated list of your target webhook URLs:

```env
TARGET_URLS=https://hooks.slack.com/services/XXX/YYY/ZZZ,https://api.other.com/hook
```

**Option B — Config file (full control)**

```bash
cp config.example.json config.json
# Edit config.json to define targets, auth, transforms, rate limits, etc.
```

### 3. Run the server

```bash
npm start          # production
npm run dev        # development (auto-restart with nodemon)
```

The server starts on port **3000** by default:

- Webhook endpoint → `http://localhost:3000/webhook`
- Admin dashboard → `http://localhost:3000/admin/stats/html`
- Health check → `http://localhost:3000/health`

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `WEBHOOK_PATH` | `/webhook` | Incoming webhook path |
| `TARGET_URLS` | — | Comma-separated target URLs |
| `TARGET_HEADERS` | `{}` | JSON object of per-target headers |
| `REQUEST_TIMEOUT_MS` | `10000` | Per-request timeout in ms |
| `RETRY_CONFIG` | `{"maxAttempts":3,"delays":[1000,3000,9000]}` | Retry settings |
| `SIGNATURE_VERIFY` | `false` | Enable HMAC signature verification |
| `SIGNATURE_SECRET` | — | Shared HMAC secret |
| `SIGNATURE_HEADER` | `x-hub-signature-256` | Header that carries the signature |
| `SIGNATURE_ALGORITHM` | `sha256` | HMAC algorithm |
| `ADMIN_USERNAME` | `admin` | Admin dashboard username |
| `ADMIN_PASSWORD` | `changeme` | Admin dashboard password |
| `ADMIN_AUTH_REQUIRED` | `true` | Enable Basic Auth on `/admin/*` |
| `MAX_STORED_WEBHOOKS` | `200` | Webhooks kept in memory for replay |
| `MAX_DLQ_ENTRIES` | `500` | Max dead-letter queue entries |
| `LOG_LEVEL` | `info` | Winston log level |

### Config File (`config.json`)

The config file supports richer per-target configuration than env vars alone.  
Copy `config.example.json` → `config.json` and adjust:

```jsonc
{
  "targets": [
    {
      "id": "slack",
      "url": "https://hooks.slack.com/services/XXX/YYY/ZZZ",
      "enabled": true,
      "headers": { "Content-Type": "application/json" },
      // Transform the payload before sending — uses {{placeholder}} syntax
      "transform": {
        "text": "Event {{event}} received from {{source}}"
      },
      // Rate-limit requests to this target
      "rateLimit": { "requestsPerMinute": 30 },
      // Per-target authentication
      "auth": { "type": "bearer", "token": "my-token" }
    }
  ]
}
```

#### Supported Auth Types

```jsonc
// Bearer token
{ "type": "bearer", "token": "..." }

// API key header
{ "type": "apikey", "header": "X-Api-Key", "value": "..." }

// HTTP Basic Auth
{ "type": "basic", "username": "...", "password": "..." }
```

#### Payload Transformation

Template placeholders resolve values from the incoming JSON body using dot-notation:

```jsonc
// Incoming payload: { "event": "push", "repo": { "name": "my-repo" } }
// Transform template:
{ "text": "{{event}} on {{repo.name}}" }
// Result sent to target:
{ "text": "push on my-repo" }
```

---

## API Reference

### `POST /webhook`

Accepts an incoming webhook. Responds immediately with `202 Accepted` then forwards to all enabled targets asynchronously.

**Request**

```http
POST /webhook
Content-Type: application/json
X-Request-Id: optional-custom-id   (optional — generated if not provided)

{ "your": "payload" }
```

**Response `202`**

```json
{
  "accepted": true,
  "requestId": "a1b2c3d4-...",
  "receivedAt": "2026-01-15T12:00:00.000Z",
  "targets": 5
}
```

---

### `GET /webhook/:requestId`

Retrieve a stored webhook payload by its request ID (for replay inspection).

**Response `200`**

```json
{
  "requestId": "a1b2c3d4-...",
  "body": { "your": "payload" },
  "headers": { "content-type": "application/json" },
  "receivedAt": "2026-01-15T12:00:00.000Z",
  "savedAt": "2026-01-15T12:00:00.001Z"
}
```

---

### `POST /webhook/:requestId/replay`

Re-forward a previously received webhook to all targets.

**Response `202`**

```json
{
  "accepted": true,
  "requestId": "new-uuid",
  "replayOf": "original-uuid"
}
```

---

### `GET /health`

```json
{
  "status": "ok",
  "timestamp": "2026-01-15T12:00:00.000Z",
  "targets": { "total": 5, "enabled": 4 },
  "retryQueue": { "pending": 2 },
  "deadLetterQueue": { "count": 0 },
  "webhookStore": { "count": 47 }
}
```

---

### `GET /admin/stats` *(requires Basic Auth)*

Returns full statistics as JSON.

### `GET /admin/stats/html` *(requires Basic Auth)*

Human-readable HTML dashboard showing:
- Total webhooks received
- Per-target success/failure counts and average response times
- Recent failures with error details

### `GET /admin/dlq` *(requires Basic Auth)*

List dead-letter queue entries.

```
GET /admin/dlq?limit=50&offset=0
```

### `DELETE /admin/dlq/:id` *(requires Basic Auth)*

Remove an entry from the dead-letter queue.

### `POST /admin/dlq/:id/retry` *(requires Basic Auth)*

Manually re-attempt delivery for a dead-letter queue entry.

### `GET /admin/webhooks` *(requires Basic Auth)*

List stored webhooks available for replay.

```
GET /admin/webhooks?limit=50&offset=0
```

### `POST /admin/reset` *(requires Basic Auth)*

Reset all statistics counters.

---

## Webhook Signature Verification (GitHub-style)

Set `SIGNATURE_VERIFY=true` and `SIGNATURE_SECRET=<your-secret>` to enable HMAC verification of incoming requests.

The service validates the `x-hub-signature-256` header (configurable via `SIGNATURE_HEADER`) against the raw request body using HMAC-SHA256.

**Generating a test signature (Node.js):**

```js
const crypto = require('crypto');
const secret = 'your-webhook-secret';
const body = JSON.stringify({ event: 'push' });
const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
// Set header: x-hub-signature-256: <sig>
```

---

## Running Tests

```bash
npm test                # run all tests with coverage
npm run test:watch      # watch mode
```

---

## Project Structure

```
src/
├── index.js              Entry point, graceful shutdown
├── app.js                Express app factory
├── config.js             Configuration loader (env + config.json)
├── routes/
│   ├── webhook.js        POST /webhook, GET /webhook/:id, replay
│   ├── admin.js          /admin/* dashboard and DLQ management
│   └── health.js         GET /health
├── services/
│   ├── forwarder.js      Core fanout logic, auth headers, axios calls
│   ├── retryQueue.js     Exponential backoff retry scheduler
│   ├── rateLimiter.js    Token-bucket rate limiter per target
│   └── transformer.js    {{placeholder}} payload template engine
├── middleware/
│   ├── requestId.js      UUID per request
│   ├── logger.js         Winston logger + request logging middleware
│   ├── signatureVerifier.js  HMAC-SHA256 verification
│   ├── adminAuth.js      Basic Auth for /admin routes
│   └── errorHandler.js   Global Express error handler
└── store/
    ├── stats.js           In-memory statistics (per-target counters)
    ├── webhookStore.js    Circular buffer for webhook replay
    └── deadLetterQueue.js In-memory DLQ for exhausted retries
tests/
├── transformer.test.js
├── forwarder.test.js
├── stores.test.js
├── signatureVerifier.test.js
├── rateLimiter.test.js
└── webhook.integration.test.js
```

---

## Production Considerations

- **Persistence**: The DLQ and webhook store are in-memory. For durability across restarts, replace them with SQLite (`better-sqlite3` is already in dependencies) or Redis.
- **Secrets**: Never commit `.env` or `config.json` — both are in `.gitignore`.
- **Admin password**: Change `ADMIN_PASSWORD` from the default `changeme`.
- **HTTPS**: Run behind a reverse proxy (nginx, Caddy) with TLS in production.
- **Scaling**: This service is stateful (in-memory queues). For horizontal scaling, move the DLQ and stats to a shared store.
