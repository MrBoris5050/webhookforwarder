/**
 * Global Express error handling middleware
 */
const { logger } = require('./logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  logger.error('unhandled_error', {
    requestId: req.requestId,
    status,
    message,
    stack: err.stack,
  });

  res.status(status).json({
    error: message,
    requestId: req.requestId,
  });
}

module.exports = errorHandler;
