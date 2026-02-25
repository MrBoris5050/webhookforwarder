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
const webhookRouter = require('./routes/webhook');
const adminRouter = require('./routes/admin');
const adminSettingsRouter = require('./routes/adminSettings');
const healthRouter = require('./routes/health');

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
  app.use(config.webhookPath, webhookRouter);
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
