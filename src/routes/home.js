/**
 * Public landing page at GET /
 */
const express = require('express');
const config  = require('../config');

const router = express.Router();

router.get('/', (req, res) => {
  const features = [
    ['⚡', 'Fan-out Delivery',  'Forwards each webhook to multiple targets simultaneously'],
    ['🔄', 'Auto Retry',        `Exponential backoff with up to ${config.retry.maxAttempts} attempts`],
    ['📭', 'Dead-Letter Queue', 'Failed deliveries are captured and available for manual retry'],
    ['🔐', 'Signature Verify',  config.signature.enabled ? 'HMAC signature verification is active' : 'HMAC signature verification available'],
    ['📊', 'Live Statistics',   'Real-time dashboard with per-target success and latency metrics'],
    ['🗄',  'Webhook Storage',   'Incoming payloads stored and replayable at any time'],
  ];

  const featureCards = features.map(([icon, title, desc]) => `
    <div class="feature-card">
      <span class="feature-icon">${icon}</span>
      <div>
        <div class="feature-title">${title}</div>
        <div class="feature-desc">${desc}</div>
      </div>
    </div>`).join('');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Webhook Forwarder</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* ── Nav ── */
  nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.1rem 2rem;
    border-bottom: 1px solid #1e293b;
    position: sticky;
    top: 0;
    background: #0f172aee;
    backdrop-filter: blur(8px);
    z-index: 10;
  }
  .nav-brand {
    display: flex;
    align-items: center;
    gap: .6rem;
    font-weight: 700;
    font-size: 1rem;
    color: #e2e8f0;
    text-decoration: none;
  }
  .nav-brand span { font-size: 1.3rem; }
  .nav-links { display: flex; gap: .5rem; align-items: center; }
  .btn-nav {
    font-size: .82rem;
    padding: .4rem .9rem;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 500;
    transition: background .15s, color .15s;
  }
  .btn-ghost { color: #94a3b8; }
  .btn-ghost:hover { color: #e2e8f0; background: #1e293b; }
  .btn-primary {
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff;
    font-weight: 600;
  }
  .btn-primary:hover { opacity: .9; }

  /* ── Hero ── */
  .hero {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 5rem 1.5rem 3rem;
  }
  .hero-pill {
    display: inline-flex;
    align-items: center;
    gap: .4rem;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 999px;
    padding: .3rem .9rem;
    font-size: .75rem;
    color: #94a3b8;
    margin-bottom: 1.8rem;
  }
  .hero-pill .dot { width: 7px; height: 7px; background: #4ade80; border-radius: 50%; }
  .hero h1 {
    font-size: clamp(2.2rem, 6vw, 3.5rem);
    font-weight: 800;
    line-height: 1.1;
    background: linear-gradient(135deg, #f1f5f9 0%, #94a3b8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 1.2rem;
  }
  .hero h1 em {
    font-style: normal;
    background: linear-gradient(90deg, #60a5fa, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .hero p {
    font-size: 1.1rem;
    color: #64748b;
    max-width: 520px;
    line-height: 1.7;
    margin-bottom: 2.5rem;
  }
  .hero-actions { display: flex; gap: .8rem; flex-wrap: wrap; justify-content: center; }
  .btn-hero {
    padding: .8rem 2rem;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    transition: opacity .15s, transform .1s;
    display: inline-flex;
    align-items: center;
    gap: .5rem;
  }
  .btn-hero:active { transform: scale(.97); }
  .btn-hero-primary {
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff;
    box-shadow: 0 4px 20px rgba(99,102,241,.35);
  }
  .btn-hero-primary:hover { opacity: .9; }
  .btn-hero-secondary {
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
  }
  .btn-hero-secondary:hover { background: #263449; border-color: #3b82f6; color: #fff; }

  /* ── Features ── */
  .features {
    max-width: 860px;
    margin: 0 auto;
    padding: 2rem 1.5rem 5rem;
    width: 100%;
  }
  .features-title {
    text-align: center;
    font-size: .78rem;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: #475569;
    margin-bottom: 1.5rem;
  }
  .features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: .9rem;
  }
  .feature-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 1rem 1.2rem;
    display: flex;
    align-items: flex-start;
    gap: .9rem;
    transition: border-color .15s;
  }
  .feature-card:hover { border-color: #3b82f644; }
  .feature-icon { font-size: 1.4rem; flex-shrink: 0; margin-top: 1px; }
  .feature-title { font-weight: 600; font-size: .9rem; margin-bottom: .2rem; }
  .feature-desc  { font-size: .78rem; color: #64748b; line-height: 1.5; }

  /* ── Footer ── */
  footer {
    text-align: center;
    color: #1e293b;
    font-size: .78rem;
    padding: 1.5rem;
    border-top: 1px solid #1e293b;
    color: #334155;
  }
  footer a { color: #3b82f6; text-decoration: none; }

  @media (max-width: 500px) {
    nav { padding: .9rem 1rem; }
    .hero { padding: 3.5rem 1rem 2rem; }
  }
</style>
</head>
<body>

<nav>
  <a class="nav-brand" href="/">
    <span>⚡</span> Webhook Forwarder
  </a>
  <div class="nav-links">
    <a class="btn-nav btn-ghost" href="/health">Health</a>
    <a class="btn-nav btn-primary" href="/login">Admin Login</a>
  </div>
</nav>

<section class="hero">
  <div class="hero-pill">
    <span class="dot"></span>
    Running on port ${config.port} &nbsp;·&nbsp; ${config.targets.length} target${config.targets.length !== 1 ? 's' : ''} configured
  </div>

  <h1>Reliable<br><em>Webhook Relay</em></h1>

  <p>
    Receives incoming webhooks and fans them out to your configured targets
    with automatic retries, dead-letter queuing, and a real-time admin dashboard.
  </p>

  <div class="hero-actions">
    <a class="btn-hero btn-hero-primary" href="/login">
      🔐 Sign In to Dashboard
    </a>
    <a class="btn-hero btn-hero-secondary" href="/health">
      💚 Health Check
    </a>
  </div>
</section>

<div class="features">
  <p class="features-title">What's included</p>
  <div class="features-grid">
    ${featureCards}
  </div>
</div>

<footer>
  Webhook Forwarder &nbsp;·&nbsp; Port ${config.port} &nbsp;·&nbsp;
  <a href="/health">Health JSON</a>
</footer>

</body>
</html>`);
});

module.exports = router;
