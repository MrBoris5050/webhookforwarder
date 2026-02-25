/**
 * Winston-based structured logger and request logging middleware
 */
const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),
  ],
});

/**
 * Express middleware that logs each request with timing info
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const requestId = req.requestId;

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      contentLength: req.headers['content-length'],
    });
  });

  next();
}

module.exports = { logger, requestLogger };
