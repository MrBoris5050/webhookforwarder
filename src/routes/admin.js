/**
 * Admin dashboard routes
 *
 * GET  /admin/stats          - JSON stats
 * GET  /admin/stats/html     - Dashboard
 * GET  /admin/dlq            - DLQ JSON
 * GET  /admin/dlq/view       - DLQ HTML page
 * DELETE /admin/dlq/:id      - Remove DLQ entry
 * POST /admin/dlq/:id/retry  - Retry DLQ entry
 * GET  /admin/webhooks       - Webhooks JSON
 * GET  /admin/webhooks/view  - Webhooks HTML page
 * POST /admin/reset          - Reset stats
 */
const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const stats = require('../store/stats');
const dlq = require('../store/deadLetterQueue');
const webhookStore = require('../store/webhookStore');
const retryQueue = require('../services/retryQueue');
const { forwardToAllTargets } = require('../services/forwarder');
const { logger } = require('../middleware/logger');
const config = require('../config');

const router = express.Router();
router.use(adminAuth);

/* ═══════════════════════════════════════════════════════════════
   SHARED LAYOUT
═══════════════════════════════════════════════════════════════ */

const SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #080d16;
    --surface:  #0f1923;
    --surface2: #162032;
    --border:   #1e2d42;
    --border2:  #243548;
    --text:     #e2e8f0;
    --muted:    #64748b;
    --muted2:   #94a3b8;
    --blue:     #3b82f6;
    --blue-dim: #1e3a5f;
    --green:    #22c55e;
    --green-dim:#14532d;
    --red:      #ef4444;
    --red-dim:  #450a0a;
    --yellow:   #f59e0b;
    --yellow-dim:#78350f;
    --purple:   #a78bfa;
    --purple-dim:#3b0764;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    font-size: 14px;
  }

  /* ── Top nav ── */
  .topnav {
    position: sticky; top: 0; z-index: 100;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    height: 50px;
    display: flex; align-items: center; gap: .25rem;
    padding: 0 1.5rem;
  }
  .nav-brand { font-weight: 700; color: var(--text); text-decoration: none; font-size: .95rem; padding-right: .75rem; border-right: 1px solid var(--border2); margin-right: .5rem; white-space: nowrap; }
  .nav-link { color: var(--muted); text-decoration: none; font-size: .82rem; padding: .35rem .7rem; border-radius: 6px; transition: all .15s; white-space: nowrap; display: flex; align-items: center; gap: .3rem; }
  .nav-link:hover { color: var(--text); background: var(--surface2); }
  .nav-active { color: var(--blue) !important; background: var(--blue-dim) !important; }
  .nav-right { margin-left: auto; display: flex; align-items: center; gap: .75rem; }
  .pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; flex-shrink: 0; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.85)} }
  .uptime-badge { font-size: .75rem; color: var(--muted); background: var(--surface2); border: 1px solid var(--border); padding: .25rem .7rem; border-radius: 20px; }
  .btn { display: inline-flex; align-items: center; gap: .3rem; border: none; border-radius: 6px; cursor: pointer; font-size: .82rem; font-weight: 500; padding: .35rem .85rem; transition: all .15s; text-decoration: none; }
  .btn-primary { background: var(--blue); color: #fff; }
  .btn-primary:hover { background: #2563eb; }
  .btn-ghost { background: transparent; color: var(--muted2); border: 1px solid var(--border2); }
  .btn-ghost:hover { color: var(--text); border-color: var(--muted); }
  .btn-danger { background: transparent; color: var(--red); border: 1px solid var(--red-dim); }
  .btn-danger:hover { background: var(--red-dim); }
  .btn-success { background: transparent; color: var(--green); border: 1px solid var(--green-dim); }
  .btn-success:hover { background: var(--green-dim); }
  .btn-sm { padding: .2rem .55rem; font-size: .75rem; }

  /* ── Page shell ── */
  .page { max-width: 1280px; margin: 0 auto; padding: 1.75rem 1.5rem 4rem; }
  .page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.75rem; gap: 1rem; }
  .page-title { font-size: 1.25rem; font-weight: 700; }
  .page-sub { font-size: .8rem; color: var(--muted); margin-top: .2rem; }

  /* ── Stat cards ── */
  .stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin-bottom: 1.75rem; }
  @media(max-width:900px){ .stat-grid { grid-template-columns: repeat(3,1fr); } }
  @media(max-width:600px){ .stat-grid { grid-template-columns: repeat(2,1fr); } }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 1.1rem 1.2rem; position: relative; overflow: hidden;
  }
  .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
  .stat-card.c-blue::before   { background: var(--blue); }
  .stat-card.c-green::before  { background: var(--green); }
  .stat-card.c-red::before    { background: var(--red); }
  .stat-card.c-yellow::before { background: var(--yellow); }
  .stat-card.c-purple::before { background: var(--purple); }
  .stat-icon { font-size: 1.3rem; margin-bottom: .5rem; }
  .stat-value { font-size: 1.9rem; font-weight: 700; line-height: 1; }
  .stat-value.c-blue   { color: var(--blue); }
  .stat-value.c-green  { color: var(--green); }
  .stat-value.c-red    { color: var(--red); }
  .stat-value.c-yellow { color: var(--yellow); }
  .stat-value.c-purple { color: var(--purple); }
  .stat-label { font-size: .7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-top: .35rem; }

  /* ── Section headers ── */
  .section-title { font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: .9rem; display: flex; align-items: center; gap: .5rem; }
  .section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }

  /* ── Cards/panels ── */
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .panel-body { padding: 1.2rem; }
  .panel-footer { padding: .75rem 1.2rem; border-top: 1px solid var(--border); background: var(--surface2); font-size: .75rem; color: var(--muted); }

  /* ── Target health cards ── */
  .targets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: .9rem; margin-bottom: 1.75rem; }
  .target-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.1rem; position: relative; }
  .target-card.target-ok     { border-left: 3px solid var(--green); }
  .target-card.target-warn   { border-left: 3px solid var(--yellow); }
  .target-card.target-error  { border-left: 3px solid var(--red); }
  .target-card.target-idle   { border-left: 3px solid var(--border2); }
  .target-top { display: flex; align-items: center; gap: .5rem; margin-bottom: .6rem; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot-ok     { background: var(--green); }
  .dot-warn   { background: var(--yellow); }
  .dot-error  { background: var(--red); }
  .dot-idle   { background: var(--muted); }
  .target-id  { font-weight: 600; font-size: .88rem; }
  .target-url { font-size: .72rem; color: var(--muted); font-family: monospace; word-break: break-all; margin-bottom: .75rem; }
  .target-metrics { display: flex; gap: 1rem; font-size: .78rem; margin-bottom: .7rem; }
  .tm-success { color: var(--green); }
  .tm-fail    { color: var(--red); }
  .tm-time    { color: var(--muted2); }
  .progress-wrap { background: var(--bg); border-radius: 4px; height: 5px; overflow: hidden; }
  .progress-bar  { height: 100%; border-radius: 4px; transition: width .4s; }
  .progress-label { display: flex; justify-content: space-between; font-size: .68rem; color: var(--muted); margin-top: .3rem; }
  .tag { font-size: .65rem; background: var(--surface2); border: 1px solid var(--border2); border-radius: 4px; padding: 1px 5px; color: var(--muted2); margin-left: auto; }
  .target-disabled { opacity: .45; }

  /* ── Layout grid ── */
  .grid-3-2 { display: grid; grid-template-columns: 3fr 2fr; gap: 1.25rem; margin-bottom: 1.75rem; }
  @media(max-width:800px){ .grid-3-2 { grid-template-columns: 1fr; } }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-bottom: 1.75rem; }
  @media(max-width:700px){ .grid-2 { grid-template-columns: 1fr; } }

  /* ── Activity feed ── */
  .activity-feed { display: flex; flex-direction: column; gap: 0; }
  .activity-item { display: flex; gap: .75rem; align-items: flex-start; padding: .65rem .9rem; border-bottom: 1px solid var(--border); }
  .activity-item:last-child { border-bottom: none; }
  .activity-item:hover { background: var(--surface2); }
  .activity-icon { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: .85rem; flex-shrink: 0; margin-top: 1px; }
  .ai-success { background: #14532d33; }
  .ai-failure { background: #450a0a33; }
  .ai-retry   { background: #78350f33; }
  .activity-body { flex: 1; min-width: 0; }
  .activity-title { font-size: .82rem; font-weight: 500; display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
  .activity-meta  { font-size: .72rem; color: var(--muted); margin-top: 2px; }
  .activity-time  { font-size: .7rem; color: var(--muted); white-space: nowrap; }
  .pill { font-size: .65rem; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
  .pill-success { background: var(--green-dim); color: var(--green); }
  .pill-failure { background: var(--red-dim); color: var(--red); }
  .pill-retry   { background: var(--yellow-dim); color: var(--yellow); }
  .empty-state { padding: 2.5rem; text-align: center; color: var(--muted); font-size: .85rem; }
  .empty-icon  { font-size: 2rem; margin-bottom: .5rem; }

  /* ── System info ── */
  .info-row { display: flex; justify-content: space-between; align-items: center; padding: .6rem .9rem; border-bottom: 1px solid var(--border); font-size: .82rem; }
  .info-row:last-child { border-bottom: none; }
  .info-label { color: var(--muted2); }
  .info-value { font-family: monospace; font-size: .78rem; color: var(--text); text-align: right; max-width: 55%; word-break: break-all; }

  /* ── Tables ── */
  .data-table { width: 100%; border-collapse: collapse; }
  .data-table th { background: var(--bg); text-align: left; padding: .6rem 1rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); border-bottom: 1px solid var(--border); }
  .data-table td { padding: .65rem 1rem; border-bottom: 1px solid var(--border); font-size: .82rem; vertical-align: middle; }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table tr:hover td { background: var(--surface2); }
  .data-table .mono { font-family: monospace; font-size: .75rem; color: var(--muted2); }

  /* ── Utilities ── */
  code { background: var(--bg); padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: .78rem; color: var(--purple); }
  .text-muted  { color: var(--muted); }
  .text-green  { color: var(--green); }
  .text-red    { color: var(--red); }
  .text-yellow { color: var(--yellow); }
  .truncate    { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
  .flex-center { display: flex; align-items: center; gap: .4rem; }
  .gap-sm      { gap: .4rem; }

  /* ── Auto-refresh toggle ── */
  .refresh-toggle { display: flex; align-items: center; gap: .5rem; font-size: .78rem; color: var(--muted); cursor: pointer; }
  .toggle-switch { position: relative; width: 30px; height: 16px; }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-slider { position: absolute; inset: 0; background: var(--border2); border-radius: 10px; transition: .2s; cursor: pointer; }
  .toggle-slider::before { content: ''; position: absolute; width: 12px; height: 12px; left: 2px; top: 2px; background: #fff; border-radius: 50%; transition: .2s; }
  input:checked + .toggle-slider { background: var(--blue); }
  input:checked + .toggle-slider::before { transform: translateX(14px); }
  #refresh-countdown { font-variant-numeric: tabular-nums; min-width: 20px; }

  /* ── Modal ── */
  .modal-backdrop { position: fixed; inset: 0; background: #000a; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 1rem; opacity: 0; pointer-events: none; transition: opacity .2s; }
  .modal-backdrop.open { opacity: 1; pointer-events: auto; }
  .modal { background: var(--surface); border: 1px solid var(--border2); border-radius: 12px; width: 100%; max-width: 540px; max-height: 90vh; overflow-y: auto; }
  .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.2rem; border-bottom: 1px solid var(--border); }
  .modal-title { font-weight: 600; font-size: .95rem; }
  .modal-close { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 1.2rem; line-height: 1; }
  .modal-body  { padding: 1.2rem; }
  .modal-pre   { background: var(--bg); border-radius: 8px; padding: 1rem; font-family: monospace; font-size: .78rem; color: var(--muted2); overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; line-height: 1.6; }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
`;

function navHtml(active) {
  const links = [
    { href: '/admin/stats/html',  label: '📊 Dashboard' },
    { href: '/admin/settings',    label: '⚙️ Settings'  },
    { href: '/admin/dlq/view',    label: '📭 DLQ'       },
    { href: '/admin/webhooks/view', label: '🗂 Webhooks' },
  ];
  return `
  <nav class="topnav">
    <a class="nav-brand" href="/">⚡ Webhook Forwarder</a>
    ${links.map(l => `<a href="${l.href}" class="nav-link ${l.href === active ? 'nav-active' : ''}">${l.label}</a>`).join('')}
    <div class="nav-right" id="nav-right-slot">
      <a href="/logout" class="nav-link" style="color:#f87171;" title="Sign out">🚪 Logout</a>
    </div>
  </nav>`;
}

function htmlPage(title, active, bodyContent, scripts = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Webhook Forwarder</title>
<style>${SHARED_CSS}</style>
</head>
<body>
${navHtml(active)}
${bodyContent}
${scripts}
</body>
</html>`;
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD  /admin/stats/html
═══════════════════════════════════════════════════════════════ */

router.get('/stats/html', async (req, res) => {
  const summary  = await stats.getSummary();
  const dlqCount = await dlq.count();
  const pending  = retryQueue.pendingCount;
  const allTargets = config.targets;

  // ── Overall success rate ──────────────────────────────────────
  const totalSuccess = summary.targets.reduce((s, t) => s + t.success, 0);
  const totalFail    = summary.targets.reduce((s, t) => s + t.failure, 0);
  const totalAttempts = totalSuccess + totalFail;
  const successRate  = totalAttempts > 0 ? Math.round((totalSuccess / totalAttempts) * 100) : 100;
  const avgResp      = summary.targets.length > 0
    ? Math.round(summary.targets.reduce((s, t) => s + t.avgResponseMs, 0) / summary.targets.length)
    : 0;

  // ── Target health cards ───────────────────────────────────────
  const targetCards = allTargets.map(target => {
    const ts = summary.targets.find(s => s.id === target.id);
    const successCount  = ts?.success  || 0;
    const failCount     = ts?.failure  || 0;
    const totalCount    = successCount + failCount;
    const rate          = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : null;
    const barColor      = rate === null ? '#243548' : rate >= 90 ? 'var(--green)' : rate >= 60 ? 'var(--yellow)' : 'var(--red)';
    const cardClass     = !target.enabled ? 'target-idle target-disabled' : rate === null ? 'target-idle' : rate >= 90 ? 'target-ok' : rate >= 60 ? 'target-warn' : 'target-error';
    const dotClass      = !target.enabled ? 'dot-idle' : rate === null ? 'dot-idle' : rate >= 90 ? 'dot-ok' : rate >= 60 ? 'dot-warn' : 'dot-error';
    const tags = [
      target.auth      ? target.auth.type : null,
      target.transform ? 'transform'      : null,
      target.rateLimit ? 'rate-limited'   : null,
      !target.enabled  ? 'disabled'       : null,
    ].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');

    return `
    <div class="target-card ${cardClass}">
      <div class="target-top">
        <span class="status-dot ${dotClass}"></span>
        <span class="target-id">${target.id}</span>
        ${tags}
      </div>
      <div class="target-url">${target.url}</div>
      <div class="target-metrics">
        <span class="tm-success">✓ ${successCount} ok</span>
        <span class="tm-fail">✗ ${failCount} fail</span>
        ${ts ? `<span class="tm-time">~${ts.avgResponseMs}ms</span>` : ''}
      </div>
      <div class="progress-wrap">
        <div class="progress-bar" style="width:${rate ?? 0}%;background:${barColor}"></div>
      </div>
      <div class="progress-label">
        <span>${rate !== null ? rate + '% success' : 'No requests'}</span>
        <span>${totalCount} total</span>
      </div>
    </div>`;
  }).join('') || `<div class="empty-state"><div class="empty-icon">🎯</div><div>No targets configured.<br><a href="/admin/settings" style="color:var(--blue)">Add targets in Settings →</a></div></div>`;

  // ── Activity feed ─────────────────────────────────────────────
  const activityItems = summary.recentActivity.slice(0, 12).map(item => {
    const isSuccess = item.status === 'success';
    const relTime = timeSince(item.timestamp);
    return `
    <div class="activity-item">
      <div class="activity-icon ${isSuccess ? 'ai-success' : 'ai-failure'}">${isSuccess ? '✓' : '✗'}</div>
      <div class="activity-body">
        <div class="activity-title">
          <span>${item.targetId}</span>
          <span class="pill ${isSuccess ? 'pill-success' : 'pill-failure'}">${isSuccess ? 'delivered' : 'failed'}</span>
          ${item.durationMs ? `<span class="text-muted" style="font-size:.7rem">${item.durationMs}ms</span>` : ''}
        </div>
        <div class="activity-meta"><code>${item.requestId?.slice(0, 8)}…</code>${item.error ? ` · ${item.error}` : ''}</div>
      </div>
      <div class="activity-time">${relTime}</div>
    </div>`;
  }).join('') || `<div class="empty-state"><div class="empty-icon">📡</div>No activity yet. Send a webhook to get started.</div>`;

  // ── Recent failures ───────────────────────────────────────────
  const failureRows = summary.recentFailures.slice(0, 8).map(f => `
    <tr>
      <td><code>${f.requestId?.slice(0, 8)}…</code></td>
      <td><span class="pill pill-failure">${f.targetId}</span></td>
      <td class="truncate text-red" style="max-width:200px" title="${f.error}">${f.error || '—'}</td>
      <td class="text-muted">${f.statusCode || '—'}</td>
      <td class="text-muted mono">${timeSince(f.timestamp)}</td>
    </tr>`).join('');

  // ── System info ───────────────────────────────────────────────
  const memMb = (process.memoryUsage().rss / 1048576).toFixed(1);
  const infoRows = [
    ['Node.js',          process.version],
    ['Memory (RSS)',     `${memMb} MB`],
    ['Uptime',          summary.uptime],
    ['Timeout',         `${config.timeout}ms`],
    ['Retry attempts',  config.retry.maxAttempts],
    ['Retry delays',    config.retry.delays.join(' → ') + 'ms'],
    ['Webhook path',    config.webhookPath],
    ['Targets enabled', `${allTargets.filter(t => t.enabled).length} / ${allTargets.length}`],
    ['Sig. verify',     config.signature.enabled ? `✓ ${config.signature.algorithm}` : '✗ off'],
  ].map(([label, value]) => `
    <div class="info-row">
      <span class="info-label">${label}</span>
      <span class="info-value">${value}</span>
    </div>`).join('');

  const successRateColor = successRate >= 90 ? 'c-green' : successRate >= 60 ? 'c-yellow' : 'c-red';

  const body = `
<div class="page">
  <div class="page-header">
    <div>
      <div class="page-title">Dashboard</div>
      <div class="page-sub">Last updated at ${new Date().toLocaleTimeString()}</div>
    </div>
    <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
      <label class="refresh-toggle" title="Auto-refresh every 15s">
        <span>Auto-refresh</span>
        <span class="toggle-switch">
          <input type="checkbox" id="auto-refresh-toggle" checked>
          <span class="toggle-slider"></span>
        </span>
        <span id="refresh-countdown">15</span>s
      </label>
      <button class="btn btn-ghost" onclick="location.reload()">↺ Refresh</button>
      <button class="btn btn-danger btn-sm" onclick="resetStats()">Reset Stats</button>
      <a href="/admin/stats" class="btn btn-ghost btn-sm">{ } JSON</a>
    </div>
  </div>

  <!-- Stat cards -->
  <div class="stat-grid">
    <div class="stat-card c-blue">
      <div class="stat-icon">📨</div>
      <div class="stat-value c-blue">${summary.totalReceived}</div>
      <div class="stat-label">Webhooks Received</div>
    </div>
    <div class="stat-card ${successRateColor}">
      <div class="stat-icon">📈</div>
      <div class="stat-value ${successRateColor}">${successRate}%</div>
      <div class="stat-label">Delivery Success Rate</div>
    </div>
    <div class="stat-card c-yellow">
      <div class="stat-icon">🔄</div>
      <div class="stat-value c-yellow">${pending}</div>
      <div class="stat-label">Retry Queue</div>
    </div>
    <div class="stat-card ${dlqCount > 0 ? 'c-red' : 'c-green'}">
      <div class="stat-icon">📭</div>
      <div class="stat-value ${dlqCount > 0 ? 'c-red' : 'c-green'}">${dlqCount}</div>
      <div class="stat-label">Dead-Letter Queue</div>
    </div>
    <div class="stat-card c-purple">
      <div class="stat-icon">⚡</div>
      <div class="stat-value c-purple">${avgResp || '—'}<span style="font-size:.9rem;font-weight:400">${avgResp ? 'ms' : ''}</span></div>
      <div class="stat-label">Avg Response Time</div>
    </div>
  </div>

  <!-- Target health -->
  <div class="section-title">Target Health</div>
  <div class="targets-grid">${targetCards}</div>

  <!-- Activity + System -->
  <div class="grid-3-2">
    <div>
      <div class="section-title">Live Activity Feed</div>
      <div class="panel">
        <div class="activity-feed">${activityItems}</div>
        ${summary.recentActivity.length > 12 ? `<div class="panel-footer">${summary.recentActivity.length} total events recorded this session</div>` : ''}
      </div>
    </div>
    <div>
      <div class="section-title">System Info</div>
      <div class="panel">${infoRows}</div>
    </div>
  </div>

  <!-- Recent failures -->
  <div class="section-title">Recent Failures</div>
  <div class="panel">
    ${summary.recentFailures.length === 0
      ? `<div class="empty-state"><div class="empty-icon">✅</div>No failures recorded this session.</div>`
      : `<table class="data-table">
          <thead><tr><th>Request ID</th><th>Target</th><th>Error</th><th>Status</th><th>When</th></tr></thead>
          <tbody>${failureRows}</tbody>
        </table>
        <div class="panel-footer">Showing ${Math.min(8, summary.recentFailures.length)} of ${summary.recentFailures.length} failures · <a href="/admin/dlq/view" style="color:var(--blue)">View DLQ →</a></div>`
    }
  </div>
</div>

<!-- Payload modal -->
<div class="modal-backdrop" id="modal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title" id="modal-title">Details</span>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <pre class="modal-pre" id="modal-body"></pre>
    </div>
  </div>
</div>`;

  const scripts = `<script>
// ── Auto-refresh ──────────────────────────────────────────────
let countdown = 15;
let timer;
const toggle = document.getElementById('auto-refresh-toggle');
const countEl = document.getElementById('refresh-countdown');

function tick() {
  countdown--;
  if (countEl) countEl.textContent = countdown;
  if (countdown <= 0) location.reload();
}

function startTimer() { timer = setInterval(tick, 1000); }
function stopTimer()  { clearInterval(timer); countdown = 15; if(countEl) countEl.textContent = 15; }

if (toggle) {
  toggle.addEventListener('change', () => toggle.checked ? startTimer() : stopTimer());
  startTimer();
}

// ── Reset stats ───────────────────────────────────────────────
async function resetStats() {
  if (!confirm('Reset all statistics? This cannot be undone.')) return;
  await fetch('/admin/reset', { method: 'POST' });
  location.reload();
}

// ── Modal ─────────────────────────────────────────────────────
function openModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = content;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });
</script>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(htmlPage('Dashboard', '/admin/stats/html', body, scripts));
});

/* ═══════════════════════════════════════════════════════════════
   DLQ HTML VIEW  /admin/dlq/view
═══════════════════════════════════════════════════════════════ */

router.get('/dlq/view', async (req, res) => {
  const entries = await dlq.list(100, 0);
  const dlqCount = await dlq.count();

  const rows = entries.map(e => `
    <tr id="dlq-${e.id}">
      <td>
        <code style="font-size:.72rem">${e.id}</code><br>
        <span class="text-muted" style="font-size:.7rem">${timeSince(e.failedAt)}</span>
      </td>
      <td><span class="pill pill-failure">${e.targetId || '—'}</span></td>
      <td class="truncate" title="${(e.targetUrl||'').replace(/"/g,'&quot;')}" style="max-width:200px;font-family:monospace;font-size:.72rem;color:var(--muted2)">${e.targetUrl || '—'}</td>
      <td class="text-red" style="font-size:.8rem">${e.error || '—'}</td>
      <td class="text-muted">${e.statusCode || '—'}</td>
      <td class="text-muted">${e.attempts ?? '—'}</td>
      <td>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-success btn-sm" onclick="retryEntry('${e.id}')">↺ Retry</button>
          <button class="btn btn-ghost btn-sm" onclick="viewDlqPayload('${e.id}')">View</button>
          <button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')">✕</button>
        </div>
      </td>
    </tr>`).join('');

  const body = `
<div class="page">
  <div class="page-header">
    <div>
      <div class="page-title">Dead-Letter Queue</div>
      <div class="page-sub">${dlqCount} entr${dlqCount === 1 ? 'y' : 'ies'} — webhooks that exhausted all retry attempts</div>
    </div>
    <div style="display:flex;gap:.6rem">
      <button class="btn btn-ghost" onclick="location.reload()">↺ Refresh</button>
      ${dlqCount > 0 ? `<button class="btn btn-danger" onclick="clearDLQ()">Clear All</button>` : ''}
    </div>
  </div>

  <div class="panel">
    ${entries.length === 0
      ? `<div class="empty-state"><div class="empty-icon">📭</div>Dead-letter queue is empty. All deliveries succeeded!</div>`
      : `<table class="data-table">
          <thead>
            <tr>
              <th>ID / Age</th>
              <th>Target</th>
              <th>URL</th>
              <th>Last Error</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
    }
  </div>
</div>

<div class="modal-backdrop" id="modal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title" id="modal-title">Payload</span>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body"><pre class="modal-pre" id="modal-body"></pre></div>
  </div>
</div>`;

  const scripts = `<script>
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });

async function viewDlqPayload(id) {
  document.getElementById('modal-title').textContent = 'DLQ Entry — ' + id.slice(0, 12) + '…';
  document.getElementById('modal-body').textContent = 'Loading…';
  document.getElementById('modal').classList.add('open');
  try {
    const r = await fetch('/admin/dlq/' + id);
    if (!r.ok) throw new Error('Not found (status ' + r.status + ')');
    const entry = await r.json();
    const display = {
      id:        entry.id,
      targetId:  entry.targetId,
      targetUrl: entry.targetUrl,
      error:     entry.error,
      statusCode:entry.statusCode,
      attempts:  entry.attempts,
      failedAt:  entry.failedAt,
      payload:   entry.payload,
    };
    document.getElementById('modal-body').textContent = JSON.stringify(display, null, 2);
  } catch(e) {
    document.getElementById('modal-body').textContent = 'Error: ' + e.message;
  }
}

async function retryEntry(id) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = '…';
  const r = await fetch('/admin/dlq/' + id + '/retry', { method: 'POST' });
  if (r.ok) { btn.textContent = '✓ Queued'; btn.style.color = 'var(--green)'; setTimeout(() => location.reload(), 1200); }
  else { btn.textContent = '✗ Error'; btn.disabled = false; }
}

async function deleteEntry(id) {
  if (!confirm('Remove this entry from the DLQ?')) return;
  const r = await fetch('/admin/dlq/' + id, { method: 'DELETE' });
  if (r.ok) { const row = document.getElementById('dlq-' + id); if(row) row.remove(); }
}

async function clearDLQ() {
  if (!confirm('Clear the entire DLQ? This cannot be undone.')) return;
  const btn = event.target;
  btn.disabled = true; btn.textContent = '…';
  const r = await fetch('/admin/dlq', { method: 'DELETE' });
  if (r.ok) {
    location.reload();
  } else {
    btn.disabled = false; btn.textContent = 'Clear All';
    alert('Failed to clear DLQ');
  }
}
</script>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(htmlPage('Dead-Letter Queue', '/admin/dlq/view', body, scripts));
});

/* ═══════════════════════════════════════════════════════════════
   WEBHOOKS HTML VIEW  /admin/webhooks/view
═══════════════════════════════════════════════════════════════ */

router.get('/webhooks/view', async (req, res) => {
  const webhooks = await webhookStore.list(100, 0);
  const webhookCount = await webhookStore.count();

  const rows = webhooks.map(w => {
    const bodyPreview = w.body ? JSON.stringify(w.body).slice(0, 80) : '(empty)';
    const targetCount = config.targets.filter(t => t.enabled).length;
    return `
    <tr>
      <td>
        <code style="font-size:.72rem">${w.requestId?.slice(0, 12)}…</code><br>
        <span class="text-muted" style="font-size:.7rem">${timeSince(w.receivedAt)}</span>
      </td>
      <td class="text-muted mono">${w.receivedAt ? new Date(w.receivedAt).toLocaleTimeString() : '—'}</td>
      <td style="font-family:monospace;font-size:.72rem;color:var(--muted2);max-width:220px" class="truncate" title="${bodyPreview}">${bodyPreview}</td>
      <td class="text-muted">${w.headers?.['content-type']?.split(';')[0] || '—'}</td>
      <td>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-primary btn-sm" onclick="replayWebhook('${w.requestId}', this)">▶ Replay</button>
          <button class="btn btn-ghost btn-sm" onclick="viewWebhook('${w.requestId}')">View</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  const body = `
<div class="page">
  <div class="page-header">
    <div>
      <div class="page-title">Stored Webhooks</div>
      <div class="page-sub">${webhookCount} of ${config.store.maxWebhooks} slots used — newest first</div>
    </div>
    <div style="display:flex;gap:.6rem">
      <button class="btn btn-ghost" onclick="location.reload()">↺ Refresh</button>
    </div>
  </div>

  <div class="panel">
    ${webhooks.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🗂</div>No webhooks stored yet. Send a webhook to <code>${config.webhookPath}</code> to get started.</div>`
      : `<table class="data-table">
          <thead>
            <tr><th>Request ID</th><th>Received</th><th>Payload Preview</th><th>Content-Type</th><th>Actions</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="panel-footer">${webhooks.length} webhook${webhooks.length !== 1 ? 's' : ''} stored (max ${config.store.maxWebhooks})</div>`
    }
  </div>
</div>

<div class="modal-backdrop" id="modal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title" id="modal-title">Payload</span>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body"><pre class="modal-pre" id="modal-body"></pre></div>
  </div>
</div>

<div id="toast" style="position:fixed;bottom:1.5rem;right:1.5rem;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:.75rem 1.1rem;font-size:.82rem;display:none;z-index:300;box-shadow:0 4px 20px #0006"></div>`;

  const scripts = `<script>
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });

function showToast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.color = ok ? 'var(--green)' : 'var(--red)';
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

async function viewWebhook(requestId) {
  document.getElementById('modal-title').textContent = 'Webhook — ' + requestId.slice(0, 12) + '…';
  document.getElementById('modal-body').textContent = 'Loading…';
  document.getElementById('modal').classList.add('open');
  try {
    const epPath = window._primaryEndpoint || '/webhook';
    const r = await fetch(epPath + '/' + requestId);
    if (!r.ok) { document.getElementById('modal-body').textContent = 'Not found (status ' + r.status + ')'; return; }
    const data = await r.json();
    const display = {
      endpoint:    data.endpointPath  || '—',
      receivedAt:  data.receivedAt    || '—',
      method:      data.method        || '—',
      contentType: data.headers?.['content-type'] || '—',
      body:        data.body,
      query:       Object.keys(data.query || {}).length ? data.query : undefined,
    };
    document.getElementById('modal-body').textContent = JSON.stringify(display, null, 2);
  } catch(e) {
    document.getElementById('modal-body').textContent = 'Error: ' + e.message;
  }
}

async function replayWebhook(requestId, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    const epPath = window._primaryEndpoint || '/webhook';
    const r = await fetch(epPath + '/' + requestId + '/replay', { method: 'POST' });
    if (r.ok) {
      btn.textContent = '✓ Sent';
      btn.style.background = 'var(--green-dim)';
      btn.style.color = 'var(--green)';
      showToast('Webhook replayed to all targets');
    } else {
      btn.textContent = '✗ Error'; btn.disabled = false;
      showToast('Replay failed', false);
    }
  } catch(e) {
    btn.textContent = '✗ Error'; btn.disabled = false;
    showToast('Network error', false);
  }
}

window._primaryEndpoint = ${JSON.stringify(config.webhookPath)};
</script>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(htmlPage('Stored Webhooks', '/admin/webhooks/view', body, scripts));
});

/* ═══════════════════════════════════════════════════════════════
   JSON APIS
═══════════════════════════════════════════════════════════════ */

router.get('/stats', async (req, res) => {
  const summary = await stats.getSummary();
  const dlqCount = await dlq.count();
  const webhookCount = await webhookStore.count();
  res.json({
    ...summary,
    retryQueue:   { pending: retryQueue.pendingCount },
    deadLetterQueue: { count: dlqCount },
    webhookStore: { count: webhookCount },
    config: {
      targets: config.targets.map(t => ({ id: t.id, url: t.url, enabled: t.enabled, hasAuth: !!t.auth, hasTransform: !!t.transform })),
      retry:   config.retry,
      timeout: config.timeout,
    },
  });
});

router.get('/dlq', async (req, res) => {
  const limit  = parseInt(req.query.limit  || '50', 10);
  const offset = parseInt(req.query.offset || '0',  10);
  const total = await dlq.count();
  const entries = await dlq.list(limit, offset);
  res.json({ total, entries });
});

router.get('/dlq/:id', async (req, res) => {
  const entry = await dlq.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'DLQ entry not found' });
  res.json(entry);
});

router.delete('/dlq', async (req, res) => {
  await dlq.clear();
  logger.info('dlq_cleared', { requestId: req.requestId });
  res.json({ cleared: true });
});

router.delete('/dlq/:id', async (req, res) => {
  const removed = await dlq.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'DLQ entry not found' });
  res.json({ deleted: true });
});

router.post('/dlq/:id/retry', async (req, res) => {
  const entry = await dlq.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'DLQ entry not found' });

  logger.info('dlq_manual_retry', { dlqId: entry.id, requestId: entry.requestId, targetId: entry.targetId });
  res.json({ accepted: true, dlqId: entry.id });

  try {
    await forwardToAllTargets({ requestId: entry.requestId, body: entry.payload, headers: entry.headers, receivedAt: entry.receivedAt });
    await dlq.remove(entry.id);
  } catch (err) {
    logger.error('dlq_retry_failed', { dlqId: entry.id, error: err.message });
  }
});

router.get('/webhooks', async (req, res) => {
  const limit  = parseInt(req.query.limit  || '50', 10);
  const offset = parseInt(req.query.offset || '0',  10);
  const total = await webhookStore.count();
  const webhooks = await webhookStore.list(limit, offset);
  res.json({ total, webhooks });
});

router.post('/reset', async (req, res) => {
  await stats.reset();
  logger.info('stats_reset', { requestId: req.requestId });
  res.json({ reset: true, timestamp: new Date().toISOString() });
});

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */

function timeSince(isoString) {
  if (!isoString) return '—';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 5)  return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

module.exports = router;
