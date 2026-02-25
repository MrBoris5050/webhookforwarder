/**
 * Entry point — starts the HTTP server and handles graceful shutdown
 */
require('dotenv').config(); // must be first — loads .env before any other module reads process.env
const net = require('net');
const db = require('./store/db');
const createApp = require('./app');
const config = require('./config');
const { logger } = require('./middleware/logger');
const retryQueue = require('./services/retryQueue');

let server;

/**
 * Resolves true if the port is free, false if already in use.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

async function start() {
  const portFree = await isPortFree(config.port);
  if (!portFree) {
    logger.error('port_in_use', {
      port: config.port,
      hint: `Port ${config.port} is already occupied. Set a different PORT in your .env file.`,
    });
    process.exit(1);
  }

  await db.init();

  if (db.isEnabled()) {
    const storedTargets = await db.getTargets();
    if (storedTargets && storedTargets.length > 0) {
      config.targets = storedTargets;
      logger.info('targets_loaded_from_db', { count: storedTargets.length });
    }
  }

  const app = createApp();
  server = app.listen(config.port, () => {
    logger.info('server_started', {
      port: config.port,
      webhookEndpoints: config.endpoints.length,
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
    config.endpoints.forEach(ep => {
      const targetNote = ep.targets ? ` (${ep.targets.length} endpoint-specific target${ep.targets.length !== 1 ? 's' : ''})` : ' (global targets)';
      logger.info(`Webhook endpoint→ http://localhost:${config.port}${ep.path}${targetNote}`);
    });
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
