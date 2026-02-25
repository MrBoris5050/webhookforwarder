/**
 * HMAC-SHA256 webhook signature verification middleware
 * Supports the GitHub-style x-hub-signature-256 pattern and generic HMAC schemes
 */
const crypto = require('crypto');
const config = require('../config');
const { logger } = require('./logger');

/**
 * Computes the HMAC signature of a raw body buffer
 */
function computeSignature(body, secret, algorithm = 'sha256') {
  return `${algorithm}=` + crypto
    .createHmac(algorithm, secret)
    .update(body)
    .digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function safeCompare(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Express middleware factory.
 * When signature verification is disabled in config this is a no-op.
 */
function signatureVerifier(req, res, next) {
  const { enabled, secret, header, algorithm } = config.signature;

  if (!enabled) return next();

  const received = req.headers[header.toLowerCase()];
  if (!received) {
    logger.warn('signature_missing', { requestId: req.requestId, header });
    return res.status(401).json({ error: `Missing signature header: ${header}` });
  }

  // rawBody is populated by the express.raw() parser mounted before JSON parsing
  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.error('signature_no_raw_body', { requestId: req.requestId });
    return res.status(500).json({ error: 'Raw body unavailable for signature verification' });
  }

  const expected = computeSignature(rawBody, secret, algorithm);
  if (!safeCompare(received, expected)) {
    logger.warn('signature_invalid', { requestId: req.requestId, received, expected });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

module.exports = { signatureVerifier, computeSignature };
