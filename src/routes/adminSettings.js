/**
 * Admin Settings page
 * GET  /admin/settings        - render the settings form
 * POST /admin/settings        - apply changes to runtime config + write .env
 */
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const webhookStore = require('../store/webhookStore');
const dlq = require('../store/deadLetterQueue');
const db = require('../store/db');
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
function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currentTargetUrls() {
  return config.targets.map(t => t.url).join('\n');
}

function targetRowsForForm() {
  const targets = config.targets;
  const rows = targets.map((t, i) => {
    const hasSecret = Boolean(t.signature?.secret);
    const secretHash = hasSecret
      ? crypto.createHash('sha256').update(t.signature.secret).digest('hex').slice(0, 12)
      : '';
    return {
      index: i,
      url: t.url,
      sigHeader: t.signature?.header || '',
      sigSecret: hasSecret ? '********' : '',
      sigAlgorithm: t.signature?.algorithm || 'sha256',
      hasSecret,
      secretHash,
      endpoints: Array.isArray(t.endpoints) ? t.endpoints : [],
    };
  });
  rows.push({ index: targets.length, url: '', sigHeader: '', sigSecret: '', sigAlgorithm: 'sha256', hasSecret: false, secretHash: '', endpoints: [] });
  return rows;
}

function endpointRowsForForm() {
  const rows = config.endpoints.map((ep, i) => ({ index: i, path: ep.path, hasCustomTargets: Boolean(ep.targets) }));
  // Extra empty row for adding a new endpoint
  rows.push({ index: config.endpoints.length, path: '', hasCustomTargets: false });
  return rows;
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
    targetRows: targetRowsForForm(),
    endpointRows: endpointRowsForForm(),
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
  .saved-hash { font-family: ui-monospace, monospace; font-size: .7rem; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
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

  /* ── Target row ── */
  .target-row { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 1rem 1.2rem; margin-bottom: .8rem; }
  .target-row-head { font-size: .75rem; font-weight: 600; color: #64748b; margin-bottom: .6rem; text-transform: uppercase; letter-spacing: .05em; }
  .target-row .field { margin-bottom: .6rem; }
  .target-row .field:last-child { margin-bottom: 0; }
  .target-row input[type="password"] { font-family: inherit; }
  .secret-saved { font-size: .7rem; font-weight: 600; color: #4ade80; text-transform: none; letter-spacing: 0; margin-left: .4rem; }

  /* ── Endpoint filter checkboxes (inside target rows) ── */
  .ep-checks { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .3rem; }
  .ep-check-label { display: inline-flex; align-items: center; gap: .35rem; font-size: .78rem; color: #94a3b8; background: #0f172a; border: 1px solid #334155; border-radius: 5px; padding: .28rem .65rem; cursor: pointer; transition: border-color .15s, color .15s; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .ep-check-label:hover { border-color: #475569; color: #e2e8f0; }
  .ep-check-label input[type="checkbox"] { margin: 0; width: 13px; height: 13px; accent-color: #3b82f6; cursor: pointer; }
  .ep-check-label.checked { border-color: #3b82f6; background: #1e3a5f33; color: #93c5fd; }
  .ep-all-badge { font-size: .72rem; color: #64748b; font-style: italic; padding: .28rem 0; }

  /* ── Endpoint row ── */
  .endpoint-row { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: .85rem 1.2rem; margin-bottom: .7rem; display: flex; align-items: center; gap: .8rem; }
  .endpoint-row-num { font-size: .7rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .05em; min-width: 72px; }
  .endpoint-row-badge { font-size: .65rem; font-weight: 600; background: #1e3a5f; color: #60a5fa; border-radius: 4px; padding: 1px 6px; margin-left: .3rem; text-transform: none; letter-spacing: 0; }
  .endpoint-row-badge-custom { background: #1a2e1a; color: #4ade80; }
  .endpoint-row input[type="text"] { flex: 1; }
  .endpoint-row-url { font-size: .72rem; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; font-family: ui-monospace, monospace; }
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

    <!-- Webhook Endpoints -->
    <div class="card">
      <div class="card-header">
        <span class="card-icon">🔗</span>
        <div>
          <h2>Webhook Endpoints</h2>
          <p>Paths that accept incoming webhooks. All endpoints forward to the global targets below. Changes apply immediately.</p>
        </div>
      </div>
      <div class="card-body">
        ${(v.endpointRows || endpointRowsForForm()).map(row => `
        <div class="endpoint-row">
          <span class="endpoint-row-num">
            ${row.index === 0 ? 'Primary' : `Path ${row.index + 1}`}
            ${row.index === 0 ? '<span class="endpoint-row-badge">default</span>' : ''}
            ${row.hasCustomTargets ? '<span class="endpoint-row-badge endpoint-row-badge-custom">custom targets</span>' : ''}
          </span>
          <input type="text" name="endpoint_${row.index}_path"
            value="${escapeHtml(row.path)}"
            placeholder="${row.index === 0 ? '/webhook' : '/webhook/my-source'}"
            ${row.hasCustomTargets ? 'readonly title="Targets managed via config.json"' : ''}>
          ${row.path ? `<span class="endpoint-row-url" title="POST to this path">POST ${escapeHtml(row.path)}</span>` : ''}
        </div>
        `).join('')}
        <div class="hint">Leave path empty to remove an endpoint. The primary path is always required. Paths must start with <code style="background:#0f172a;padding:1px 4px;border-radius:4px;color:#94a3b8">/</code>. Endpoints with <span style="color:#4ade80;font-size:.7rem;font-weight:600">custom targets</span> are managed via config.json.</div>
      </div>
    </div>

    <!-- Target URLs -->
    <div class="card">
      <div class="card-header">
        <span class="card-icon">🎯</span>
        <div>
          <h2>Target URLs</h2>
          <p>Each target can have an optional outgoing signature (e.g. x-jessco-signature) for the receiving API.</p>
        </div>
      </div>
      <div class="card-body">
        ${(v.targetRows || targetRowsForForm()).map((row, idx) => `
        <div class="target-row">
          <div class="target-row-head">Target ${row.index + 1}${row.index >= config.targets.length ? ' (new)' : ''}</div>
          <div class="field">
            <label>URL</label>
            <input type="text" name="target_${row.index}_url" value="${(row.url || '').replace(/"/g, '&quot;')}" placeholder="https://api.example.com/webhook">
          </div>
          <div class="row-2">
            <div class="field">
              <label>Signature header (optional)</label>
              <input type="text" name="target_${row.index}_sig_header" value="${(row.sigHeader || '').replace(/"/g, '&quot;')}" placeholder="e.g. x-jessco-signature">
              ${row.sigHeader ? `<div class="hint" style="margin-top:4px">Saved header: <code class="saved-hash">${escapeHtml(row.sigHeader)}</code></div>` : ''}
            </div>
            <div class="field">
              <label>Signature secret (optional) ${row.hasSecret ? `<span class="secret-saved">✓ Saved${db.isEnabled() ? '' : ' in .env'}</span>` : ''}</label>
              <input type="password" name="target_${row.index}_sig_secret" value="${(row.sigSecret || '').replace(/"/g, '&quot;')}" placeholder="${row.hasSecret ? 'Leave blank to keep current secret' : 'Set to enable outgoing signature'}" autocomplete="off">
              ${row.hasSecret && row.secretHash ? `<div class="hint" style="margin-top:4px">Secret hash (SHA-256): <code class="saved-hash">${row.secretHash}</code></div>` : ''}
            </div>
          </div>
          <div class="field" style="max-width:200px">
            <label>Signature algorithm</label>
            <input type="text" name="target_${row.index}_sig_algorithm" value="${(row.sigAlgorithm || 'sha256').replace(/"/g, '&quot;')}" placeholder="sha256">
          </div>
          <div class="field">
            <label>Receive from <span class="hint">(leave all unchecked = receive from every endpoint)</span></label>
            <div class="ep-checks">
              ${config.endpoints.length === 0
                ? '<span class="ep-all-badge">No endpoints configured yet</span>'
                : config.endpoints.map(ep => {
                    const checked = (row.endpoints || []).includes(ep.path);
                    return `<label class="ep-check-label${checked ? ' checked' : ''}">
                      <input type="checkbox" name="target_${row.index}_endpoints" value="${escapeHtml(ep.path)}"${checked ? ' checked' : ''}
                        onchange="this.closest('.ep-check-label').classList.toggle('checked', this.checked)">
                      ${escapeHtml(ep.path)}
                    </label>`;
                  }).join('')
              }
            </div>
          </div>
        </div>
        `).join('')}
        <div class="hint">Leave URL empty on the last row to add a new target. Signature is sent as HMAC(body, secret) in the header when both header and secret are set. ${db.isEnabled() ? 'Targets and signatures are stored in the database (survives restart).' : 'Secrets are stored in <code style="background:#0f172a;padding:1px 4px;border-radius:4px;color:#94a3b8">.env</code> as <code style="background:#0f172a;padding:1px 4px;border-radius:4px;color:#94a3b8">TARGET_1_SIGNATURE_*</code>, etc. After refresh you’ll see “✓ Saved in .env” when a secret is set.'}</div>
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
      <p>💡 Restart the server to pick up PORT changes. Endpoint paths apply immediately.</p>
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
      targetRows: targetRowsForForm(),
      endpointRows: endpointRowsForForm(),
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
router.post('/', async (req, res) => {
  const errors = [];

  // ── Parse target rows (target_0_url, target_0_sig_header, ...) ──
  const urlKeys = Object.keys(req.body).filter(k => /^target_\d+_url$/.test(k));
  const maxIndex = urlKeys.length ? Math.max(...urlKeys.map(k => parseInt(k.replace('target_', '').replace('_url', ''), 10))) : -1;
  const rawUrls = [];
  const targetSignatures = [];
  const targetEndpoints = [];
  for (let i = 0; i <= maxIndex; i++) {
    const url = (req.body[`target_${i}_url`] || '').trim();
    if (!url) continue;
    try {
      new URL(url);
    } catch {
      errors.push(`Invalid URL at target ${i + 1}: "${url}"`);
      continue;
    }
    rawUrls.push(url);
    const sigHeader = (req.body[`target_${i}_sig_header`] || '').trim();
    let sigSecret = (req.body[`target_${i}_sig_secret`] || '').trim();
    if (sigSecret === '********' || sigSecret === '') {
      const existingTarget = config.targets[i];
      sigSecret = existingTarget?.signature?.secret || '';
    }
    const sigAlgorithm = (req.body[`target_${i}_sig_algorithm`] || 'sha256').trim() || 'sha256';
    if (sigHeader && sigSecret) {
      targetSignatures.push({ header: sigHeader, secret: sigSecret, algorithm: sigAlgorithm });
    } else {
      targetSignatures.push(null);
    }
    // Endpoint filter: checked checkbox values; empty array = receive from all
    const epVal = req.body[`target_${i}_endpoints`];
    targetEndpoints.push([].concat(epVal || []).filter(Boolean));
  }

  if (rawUrls.length === 0) errors.push('Add at least one target URL');

  // ── Parse endpoint paths (endpoint_0_path, endpoint_1_path, …) ──
  const epPathKeys = Object.keys(req.body).filter(k => /^endpoint_\d+_path$/.test(k));
  const maxEpIndex = epPathKeys.length
    ? Math.max(...epPathKeys.map(k => parseInt(k.replace('endpoint_', '').replace('_path', ''), 10)))
    : -1;

  const rawEndpointPaths = [];
  for (let i = 0; i <= maxEpIndex; i++) {
    const p = (req.body[`endpoint_${i}_path`] || '').trim();
    if (!p) continue;
    // Preserve existing custom-target endpoints that are marked readonly
    const existing = config.endpoints[i];
    if (existing?.targets) {
      // Never strip an endpoint that has per-endpoint targets — keep it as-is
      rawEndpointPaths.push({ path: existing.path, targets: existing.targets });
      continue;
    }
    if (!p.startsWith('/')) {
      errors.push(`Endpoint path must start with "/" (got "${p}")`);
      continue;
    }
    if (rawEndpointPaths.some(e => e.path === p)) {
      errors.push(`Duplicate endpoint path: "${p}"`);
      continue;
    }
    rawEndpointPaths.push({ path: p, targets: null });
  }
  // Also carry forward any custom-target endpoints that weren't in the form
  config.endpoints.forEach(ep => {
    if (ep.targets && !rawEndpointPaths.some(e => e.path === ep.path)) {
      rawEndpointPaths.push({ path: ep.path, targets: ep.targets });
    }
  });

  if (rawEndpointPaths.length === 0) errors.push('At least one webhook endpoint path is required');

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
    const targetRows = [];
    for (let i = 0; i <= maxIndex; i++) {
      const epVal = req.body[`target_${i}_endpoints`];
      targetRows.push({
        index: i,
        url: req.body[`target_${i}_url`] || '',
        sigHeader: req.body[`target_${i}_sig_header`] || '',
        sigSecret: req.body[`target_${i}_sig_secret`] || '',
        sigAlgorithm: req.body[`target_${i}_sig_algorithm`] || 'sha256',
        hasSecret: false,
        secretHash: '',
        endpoints: [].concat(epVal || []).filter(Boolean),
      });
    }
    targetRows.push({ index: targetRows.length, url: '', sigHeader: '', sigSecret: '', sigAlgorithm: 'sha256', hasSecret: false, secretHash: '', endpoints: [] });

    const endpointRows = [];
    for (let i = 0; i <= maxEpIndex; i++) {
      endpointRows.push({ index: i, path: req.body[`endpoint_${i}_path`] || '', hasCustomTargets: Boolean(config.endpoints[i]?.targets) });
    }
    endpointRows.push({ index: endpointRows.length, path: '', hasCustomTargets: false });

    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(renderPage({
      flash: { type: 'error', message: '❌ ' + errors.join(' · ') },
      values: {
        targetRows,
        endpointRows,
        timeoutMs: req.body.timeoutMs,
        retryMaxAttempts: req.body.retryMaxAttempts,
        retryDelays: req.body.retryDelays,
        maxWebhooks: req.body.maxWebhooks,
        maxDlq: req.body.maxDlq,
        webhookCount: '—',
        dlqCount: '—',
      },
    }));
  }

  // ── Apply to live config ─────────────────────────────────────

  const existingById = new Map(config.targets.map(t => [t.url, t]));
  config.targets = rawUrls.map((url, i) => {
    const existing = existingById.get(url);
    const sig = targetSignatures[i];
    const base = existing || {
      url,
      headers: {},
      auth: null,
      transform: null,
      rateLimit: null,
      enabled: true,
    };
    return {
      ...base,
      id: `target-${i + 1}`,
      url,
      signature: sig || (existing?.signature) || null,
      endpoints: targetEndpoints[i] || [],
    };
  });

  // Update endpoints live
  config.endpoints = rawEndpointPaths;
  config.webhookPath = rawEndpointPaths[0]?.path || '/webhook';

  config.timeout = timeoutMs;
  config.retry.maxAttempts = retryMaxAttempts;
  config.retry.delays = retryDelays;
  config.store.maxWebhooks = maxWebhooks;
  config.store.maxDLQ = maxDlq;

  // Update the store capacity limits in-place
  webhookStore.maxSize = maxWebhooks;
  dlq.maxSize = maxDlq;

  // ── Persist to .env and/or DB ──────────────────────────────────
  const simplePaths = rawEndpointPaths.filter(e => !e.targets); // only env-managed paths
  const envUpdates = {
    WEBHOOK_PATH: simplePaths[0]?.path || '/webhook',
    WEBHOOK_PATHS: simplePaths.slice(1).map(e => e.path).join(','),
    REQUEST_TIMEOUT_MS: String(timeoutMs),
    RETRY_CONFIG: JSON.stringify({ maxAttempts: retryMaxAttempts, delays: retryDelays }),
    MAX_STORED_WEBHOOKS: String(maxWebhooks),
    MAX_DLQ_ENTRIES: String(maxDlq),
  };

  if (db.isEnabled()) {
    await db.saveTargets(config.targets);
  } else {
    envUpdates.TARGET_URLS = rawUrls.join(',');
    targetSignatures.forEach((sig, i) => {
      const n = i + 1;
      if (sig) {
        envUpdates[`TARGET_${n}_SIGNATURE_HEADER`] = sig.header;
        envUpdates[`TARGET_${n}_SIGNATURE_SECRET`] = sig.secret;
        envUpdates[`TARGET_${n}_SIGNATURE_ALGORITHM`] = sig.algorithm;
      }
    });
    targetEndpoints.forEach((eps, i) => {
      const n = i + 1;
      envUpdates[`TARGET_${n}_ENDPOINTS`] = eps.join(',');
    });
  }

  try {
    updateEnvFile(envUpdates);
  } catch (err) {
    logger.warn('settings_env_write_failed', { error: err.message });
  }

  logger.info('settings_updated', {
    requestId: req.requestId,
    endpoints: rawEndpointPaths.length,
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
      message: `✅ Settings saved — ${rawEndpointPaths.length} endpoint${rawEndpointPaths.length !== 1 ? 's' : ''}, ${rawUrls.length} target${rawUrls.length !== 1 ? 's' : ''} configured, changes applied immediately. ${db.isEnabled() ? 'Targets stored in database.' : 'Written to .env.'}`,
    },
  }));
});

module.exports = router;
