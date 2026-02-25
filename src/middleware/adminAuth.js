/**
 * Admin authentication middleware.
 *
 * Accepts either:
 *   1. A valid signed session cookie (set after login via /login)
 *   2. HTTP Basic Auth with email:password (for API / curl access)
 *
 * Browser visitors without a session are redirected to /login.
 * API clients (non-browser / JSON requests) get a 401 JSON response.
 */
const config = require('../config');
const { getSession } = require('../utils/session');

function adminAuth(req, res, next) {
  if (!config.admin.authRequired) return next();

  // 1 — Cookie session (browser login)
  const session = getSession(req);
  if (session && session.email === config.admin.email) return next();

  // 2 — HTTP Basic Auth (API / programmatic access)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded   = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
    const colonIdx  = decoded.indexOf(':');
    const username  = decoded.slice(0, colonIdx);
    const password  = decoded.slice(colonIdx + 1);

    const validEmail    = username === config.admin.email    && password === config.admin.password;
    const validUsername = username === config.admin.username && password === config.admin.password;

    if (validEmail || validUsername) return next();
  }

  // 3 — Redirect browsers to login; return 401 for API clients
  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Webhook Forwarder Admin"');
  return res.status(401).json({ error: 'Authentication required' });
}

module.exports = adminAuth;
