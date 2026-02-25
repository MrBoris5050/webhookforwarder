/**
 * Express application factory
 * Separated from index.js so the app can be imported by tests without starting a server.
 */
const express = require('express');
const config = require('./config');
const requestIdMiddleware = require('./middleware/requestId');
const { requestLogger } = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');

const homeRouter = require('./routes/home');
const authRouter  = require('./routes/auth');
const { getRouter } = require('./routes/webhook');
const adminRouter = require('./routes/admin');
const adminSettingsRouter = require('./routes/adminSettings');
const healthRouter = require('./routes/health');
const deployWebhookRouter = require('./routes/deployWebhook');

function createApp() {
  const app = express();

  // ── Body parsing ──────────────────────────────────────────────
  // The `verify` hook captures the raw buffer for HMAC signature verification
  // without consuming the stream separately from the JSON parser.
  const captureRawBody = (req, res, buf) => { req.rawBody = buf; };

  app.use(express.json({ limit: '10mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '10mb', verify: captureRawBody }));

  // ── Global middleware ─────────────────────────────────────────
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  // Trust first proxy for correct IP logging
  app.set('trust proxy', 1);

  // ── Routes ───────────────────────────────────────────────────
  app.use('/', homeRouter);
  app.use('/', authRouter);
  app.use('/health', healthRouter);
  app.use('/deploy-webhook', deployWebhookRouter);

  // Dynamic webhook dispatcher — re-reads config.endpoints on every request so
  // paths added or removed via the admin settings page take effect immediately.
  app.use(function webhookDispatcher(req, res, next) {
    const sorted = [...config.endpoints].sort((a, b) => b.path.length - a.path.length);
    for (const ep of sorted) {
      if (req.path === ep.path || req.path.startsWith(ep.path + '/')) {
        const router = getRouter(ep);
        const savedUrl = req.url;
        req.url = req.url.slice(ep.path.length) || '/';
        return router(req, res, (err) => {
          req.url = savedUrl;
          next(err);
        });
      }
    }
    next();
  });

  app.use('/admin/settings', adminSettingsRouter);
  app.use('/admin', adminRouter);

  // 404 catch-all
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
