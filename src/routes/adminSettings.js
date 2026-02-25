/**
 * Admin Settings page
 * GET  /admin/settings        - render the settings form
 * POST /admin/settings        - apply changes to runtime config + write .env
 */
const express = require('express');
const config = require('../config');
const webhookStore = require('../store/webhookStore');
const dlq = require('../store/deadLetterQueue');
const { updateEnvFile } = require('../utils/envFile');
const { logger } = require('../middleware/logger');

const router = express.Router();

/* ─── Shared nav HTML ─────────────────────────────────────────── */
function adminNav(activePage) {
  const links = [
    { href: '/admin/stats/html',    label: '📊 Dashboard' },
    { href: '/admin/settings',      label: '⚙️ Settings'  },
    { href: '/admin/dlq/view',      label: '📭 DLQ'       },
    { href: '/admin/webhooks/view', label: '🗂 Webhooks'  },
  ];
  const navItems = links.map(l =>
    `<a href="${l.href}" class="nav-link ${l.href === activePage ? 'nav-active' : ''}">${l.label}</a>`
  ).join('');
  return navItems + `<a href="/logout" class="nav-link" style="color:#f87171;margin-left:auto;" title="Sign out">🚪 Logout</a>`;
}

/* ─── Helpers ─────────────────────────────────────────────────── */
function currentTargetUrls() {
  return config.targets.map(t => t.url).join('\n');
}

function renderPage({ flash, values } = {}) {
  const v = values || {
    targetUrls: currentTargetUrls(),
    timeoutMs: config.timeout,
    retryMaxAttempts: config.retry.maxAttempts,
    retryDelays: config.retry.delays.join(', '),
    maxWebhooks: config.store.maxWebhooks,
    maxDlq: config.store.maxDLQ,
    webhookCount: '—',
    dlqCount: '—',
  };

  const flashHtml = flash
    ? `<div class="flash flash-${flash.type}">${flash.message}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Settings — Webhook Forwarder</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }

  /* ── Nav ── */
  header { background: #1e293b; border-bottom: 1px solid #334155; padding: 0 2rem; display: flex; align-items: center; gap: 1.5rem; height: 52px; }
  .brand { font-weight: 700; color: #e2e8f0; text-decoration: none; font-size: .95rem; margin-right: .5rem; white-space: nowrap; }
  .nav-link { color: #94a3b8; text-decoration: none; font-size: .85rem; padding: .3rem .6rem; border-radius: 5px; white-space: nowrap; }
  .nav-link:hover { color: #e2e8f0; background: #334155; }
  .nav-active { color: #60a5fa !important; background: #1e3a5f !important; }

  /* ── Layout ── */
  main { max-width: 780px; margin: 2.5rem auto; padding: 0 1.5rem 4rem; }
  h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: .3rem; }
  .subtitle { color: #64748b; font-size: .85rem; margin-bottom: 2rem; }

  /* ── Flash ── */
  .flash { padding: .9rem 1.2rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: .88rem; display: flex; align-items: center; gap: .6rem; }
  .flash-success { background: #14532d33; border: 1px solid #166534; color: #4ade80; }
  .flash-error   { background: #450a0a33; border: 1px solid #7f1d1d; color: #f87171; }

  /* ── Card ── */
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; overflow: hidden; margin-bottom: 1.5rem; }
  .card-header { padding: 1rem 1.4rem; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: .6rem; }
  .card-header h2 { font-size: .95rem; font-weight: 600; }
  .card-header p  { font-size: .78rem; color: #64748b; margin-top: 2px; }
  .card-icon { font-size: 1.2rem; }
  .card-body { padding: 1.4rem; display: flex; flex-direction: column; gap: 1.2rem; }

  /* ── Form fields ── */
  .field { display: flex; flex-direction: column; gap: .4rem; }
  label { font-size: .8rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; display: flex; align-items: center; gap: .4rem; }
  .hint { font-size: .75rem; color: #475569; font-weight: 400; text-transform: none; letter-spacing: 0; }
  input[type="number"],
  input[type="text"],
  textarea {
    background: #0f172a; border: 1px solid #334155; border-radius: 7px;
    color: #e2e8f0; font-size: .88rem; padding: .65rem .9rem;
    font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    transition: border-color .15s;
    width: 100%;
  }
  input:focus, textarea:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px #3b82f620; }
  textarea { resize: vertical; min-height: 100px; line-height: 1.6; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 500px) { .row-2 { grid-template-columns: 1fr; } }

  /* ── Live badge ── */
  .live-val { font-size: .75rem; color: #64748b; font-weight: 400; text-transform: none; letter-spacing: 0; background: #0f172a; padding: 1px 7px; border-radius: 4px; border: 1px solid #334155; }

  /* ── Save bar ── */
  .save-bar { position: sticky; bottom: 0; background: #1e293b; border-top: 1px solid #334155; padding: 1rem 1.4rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .save-bar p { font-size: .78rem; color: #64748b; }
  .btn-save { background: #3b82f6; color: #fff; border: none; border-radius: 7px; padding: .65rem 1.8rem; font-size: .9rem; font-weight: 600; cursor: pointer; transition: background .15s; }
  .btn-save:hover { background: #2563eb; }
  .btn-save:active { background: #1d4ed8; }
  .btn-reset { background: transparent; color: #64748b; border: 1px solid #334155; border-radius: 7px; padding: .65rem 1.2rem; font-size: .85rem; cursor: pointer; }
  .btn-reset:hover { color: #e2e8f0; border-color: #475569; }

  /* ── Warning box ── */
  .warn-box { background: #78350f22; border: 1px solid #92400e; border-radius: 8px; padding: .8rem 1rem; font-size: .8rem; color: #fcd34d; display: flex; gap: .5rem; align-items: flex-start; margin-top: .2rem; }
</style>
</head>
<body>

<header>
  <a class="brand" href="/">⚡ Webhook Forwarder</a>
  ${adminNav('/admin/settings')}
</header>

<main>
  <h1>Settings</h1>
  <p class="subtitle">Changes apply immediately to the running server and are saved to your <code style="background:#1e293b;padding:1px 6px;border-radius:4px;color:#c084fc">.env</code> file.</p>

  ${flashHtml}

  <form method="POST" action="/admin/settings">

    <!-- Target URLs -->
    <div class="card">
      <div class="card-header">
        <span class="card-icon">🎯</span>
        <div>
          <h2>Target URLs</h2>
          <p>Webhooks are forwarded to all enabled targets in parallel</p>
        </div>
      </div>
      <div class="card-body">
        <div class="field">
          <label>TARGET_URLS <span class="live-val">currently ${config.targets.length} target${config.targets.length !== 1 ? 's' : ''}</span></label>
          <textarea name="targetUrls" rows="6" placeholder="https://hooks.slack.com/services/...&#10;https://api.example.com/webhook&#10;https://notify.io/hook">${v.targetUrls}</textarea>
          <div class="hint">One URL per line. Lines starting with # are ignored. Auth, transforms and rate limits per target must be configured in config.json.</div>
        </div>
      </div>
    </div>

    <!-- Request behaviour -->
    <div class="card">
      <div class="card-header">
        <span class="card-icon">⏱</span>
        <div>
          <h2>Request Behaviour</h2>
          <p>Timeout and retry settings for outbound deliveries</p>
        </div>
      </div>
      <div class="card-body">
        <div class="field">
          <label>REQUEST_TIMEOUT_MS <span class="live-val">currently ${config.timeout}ms</span></label>
          <input type="number" name="timeoutMs" value="${v.timeoutMs}" min="1000" max="60000" step="500">
          <div class="hint">Maximum time (ms) to wait for each target to respond. Default: 10000 (10 seconds).</div>
        </div>

        <div class="row-2">
          <div class="field">
            <label>Max Retry Attempts <span class="live-val">currently ${config.retry.maxAttempts}</span></label>
            <input type="number" name="retryMaxAttempts" value="${v.retryMaxAttempts}" min="0" max="10">
            <div class="hint">Set to 0 to disable retries.</div>
          </div>
          <div class="field">
            <label>Retry Delays (ms) <span class="live-val">currently ${config.retry.delays.join(', ')}ms</span></label>
            <input type="text" name="retryDelays" value="${v.retryDelays}" placeholder="1000, 3000, 9000">
            <div class="hint">Comma-separated delays between attempts.</div>
          </div>
        </div>

        <div class="warn-box">
          ⚠️ Changes to retry settings only affect <strong>new</strong> deliveries. Retries already scheduled will use the old delays.
        </div>
      </div>
    </div>

    <!-- Storage limits -->
    <div class="card">
      <div class="card-header">
        <span class="card-icon">💾</span>
        <div>
          <h2>Storage Limits</h2>
          <p>How many events to keep in memory</p>
        </div>
      </div>
      <div class="card-body">
        <div class="row-2">
          <div class="field">
            <label>MAX_STORED_WEBHOOKS <span class="live-val">currently ${v.webhookCount} stored</span></label>
            <input type="number" name="maxWebhooks" value="${v.maxWebhooks}" min="10" max="5000">
            <div class="hint">Recent webhooks kept for replay. Oldest are evicted when full.</div>
          </div>
          <div class="field">
            <label>MAX_DLQ_ENTRIES <span class="live-val">currently ${v.dlqCount} in DLQ</span></label>
            <input type="number" name="maxDlq" value="${v.maxDlq}" min="10" max="10000">
            <div class="hint">Dead-letter queue capacity. Oldest entries evicted when full.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Save bar -->
    <div class="save-bar">
      <p>💡 Restart the server to pick up PORT or WEBHOOK_PATH changes.</p>
      <div style="display:flex;gap:.6rem">
        <button type="reset" class="btn-reset">Reset</button>
        <button type="submit" class="btn-save">Save Changes</button>
      </div>
    </div>

  </form>
</main>

</body>
</html>`;
}

router.get('/', async (req, res) => {
  const webhookCount = await webhookStore.count();
  const dlqCount = await dlq.count();
  res.setHeader('Content-Type', 'text/html');
  res.send(renderPage({
    values: {
      targetUrls: currentTargetUrls(),
      timeoutMs: config.timeout,
      retryMaxAttempts: config.retry.maxAttempts,
      retryDelays: config.retry.delays.join(', '),
      maxWebhooks: config.store.maxWebhooks,
      maxDlq: config.store.maxDLQ,
      webhookCount,
      dlqCount,
    },
  }));
});

/* ─── POST ────────────────────────────────────────────────────── */
router.post('/', (req, res) => {
  const errors = [];

  // ── Parse & validate ────────────────────────────────────────

  // TARGET_URLS: one per line, skip blanks and # comments
  const rawUrls = (req.body.targetUrls || '').split('\n')
    .map(u => u.trim())
    .filter(u => u && !u.startsWith('#'));

  for (const url of rawUrls) {
    try { new URL(url); } catch {
      errors.push(`Invalid URL: "${url}"`);
    }
  }

  // REQUEST_TIMEOUT_MS
  const timeoutMs = parseInt(req.body.timeoutMs, 10);
  if (isNaN(timeoutMs) || timeoutMs < 100) errors.push('Timeout must be at least 100ms');

  // RETRY_MAX_ATTEMPTS
  const retryMaxAttempts = parseInt(req.body.retryMaxAttempts, 10);
  if (isNaN(retryMaxAttempts) || retryMaxAttempts < 0) errors.push('Retry attempts must be 0 or more');

  // RETRY_DELAYS
  const rawDelays = (req.body.retryDelays || '').split(',').map(d => parseInt(d.trim(), 10));
  const retryDelays = rawDelays.filter(d => !isNaN(d) && d >= 0);
  if (retryDelays.length === 0) errors.push('Provide at least one retry delay value (in ms)');

  // MAX_STORED_WEBHOOKS
  const maxWebhooks = parseInt(req.body.maxWebhooks, 10);
  if (isNaN(maxWebhooks) || maxWebhooks < 1) errors.push('Max stored webhooks must be at least 1');

  // MAX_DLQ_ENTRIES
  const maxDlq = parseInt(req.body.maxDlq, 10);
  if (isNaN(maxDlq) || maxDlq < 1) errors.push('Max DLQ entries must be at least 1');

  if (errors.length) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(renderPage({
      flash: { type: 'error', message: '❌ ' + errors.join(' · ') },
      values: {
        targetUrls: req.body.targetUrls,
        timeoutMs: req.body.timeoutMs,
        retryMaxAttempts: req.body.retryMaxAttempts,
        retryDelays: req.body.retryDelays,
        maxWebhooks: req.body.maxWebhooks,
        maxDlq: req.body.maxDlq,
      },
    }));
  }

  // ── Apply to live config ─────────────────────────────────────

  // Rebuild target list — preserve existing target metadata for URLs we already know
  const existingById = new Map(config.targets.map(t => [t.url, t]));
  config.targets = rawUrls.map((url, i) => {
    const existing = existingById.get(url);
    return existing || {
      id: `target-${i + 1}`,
      url,
      headers: {},
      auth: null,
      transform: null,
      rateLimit: null,
      enabled: true,
    };
  });

  config.timeout = timeoutMs;
  config.retry.maxAttempts = retryMaxAttempts;
  config.retry.delays = retryDelays;
  config.store.maxWebhooks = maxWebhooks;
  config.store.maxDLQ = maxDlq;

  // Update the store capacity limits in-place
  webhookStore.maxSize = maxWebhooks;
  dlq.maxSize = maxDlq;

  // ── Persist to .env ──────────────────────────────────────────
  try {
    updateEnvFile({
      TARGET_URLS: rawUrls.join(','),
      REQUEST_TIMEOUT_MS: String(timeoutMs),
      RETRY_CONFIG: JSON.stringify({ maxAttempts: retryMaxAttempts, delays: retryDelays }),
      MAX_STORED_WEBHOOKS: String(maxWebhooks),
      MAX_DLQ_ENTRIES: String(maxDlq),
    });
  } catch (err) {
    logger.warn('settings_env_write_failed', { error: err.message });
  }

  logger.info('settings_updated', {
    requestId: req.requestId,
    targets: rawUrls.length,
    timeoutMs,
    retryMaxAttempts,
    retryDelays,
    maxWebhooks,
    maxDlq,
  });

  res.setHeader('Content-Type', 'text/html');
  res.send(renderPage({
    flash: {
      type: 'success',
      message: `✅ Settings saved — ${rawUrls.length} target${rawUrls.length !== 1 ? 's' : ''} configured, changes applied immediately and written to .env`,
    },
  }));
});

module.exports = router;
