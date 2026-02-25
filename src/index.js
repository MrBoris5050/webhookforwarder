/**
 * Entry point — starts the HTTP server and handles graceful shutdown
 */
require('dotenv').config(); // must be first — loads .env before any other module reads process.env
const db = require('./store/db');
const createApp = require('./app');
const config = require('./config');
const { logger } = require('./middleware/logger');
const retryQueue = require('./services/retryQueue');

let server;

async function start() {
  await db.init();
  const app = createApp();
  server = app.listen(config.port, () => {
    logger.info('server_started', {
      port: config.port,
      webhookPath: config.webhookPath,
      targets: config.targets.length,
      signatureVerification: config.signature.enabled,
      adminAuth: config.admin.authRequired,
      database: config.store.mongodbUri ? 'MongoDB' : 'none (in-memory)',
    });

    if (config.targets.length === 0) {
      logger.warn('no_targets', { hint: 'Set TARGET_URLS env var or configure targets in config.json' });
    } else {
      config.targets.forEach(t => {
        logger.info('target_registered', { id: t.id, url: t.url, enabled: t.enabled });
      });
    }

    logger.info(`Admin dashboard → http://localhost:${config.port}/admin/stats/html`);
    logger.info(`Health check    → http://localhost:${config.port}/health`);
    logger.info(`Webhook endpoint→ http://localhost:${config.port}${config.webhookPath}`);
  });
  return server;
}

start().catch(err => {
  logger.error('startup_failed', { error: err.message, stack: err.stack });
  process.exit(1);
});

// ── Graceful shutdown ────────────────────────────────────────────

async function shutdown(signal) {
  logger.info('shutdown_signal', { signal });

  if (!server) return process.exit(0);
  server.close(() => {
    logger.info('http_server_closed');
    retryQueue.cancelAll();
    db.close().then(() => {
      logger.info('shutdown_complete');
      process.exit(0);
    }).catch(err => {
      logger.error('db_close_error', { error: err.message });
      process.exit(1);
    });
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('shutdown_timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', err => {
  logger.error('uncaught_exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: String(reason) });
});

module.exports = server; // for testing (set after start())
