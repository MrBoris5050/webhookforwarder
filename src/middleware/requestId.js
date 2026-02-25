/**
 * Middleware that assigns a unique request ID to every incoming request
 */
const { v4: uuidv4 } = require('uuid');

function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('x-request-id', req.requestId);
  next();
}

module.exports = requestId;
