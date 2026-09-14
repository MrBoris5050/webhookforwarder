/**
 * Arkesel USSD callback helpers.
 *
 * Incoming (developers.arkesel.com):
 *   { sessionID, userID, newSession, msisdn, userData, network }
 *
 * Response Arkesel expects:
 *   { sessionID, userID, msisdn, message, continueSession }
 */

function isEmptyBody(body) {
  if (body == null) return true;
  if (typeof body === 'string') return body.trim() === '';
  if (typeof body === 'object' && !Array.isArray(body)) return Object.keys(body).length === 0;
  return false;
}

function asBoolean(value) {
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return null;
}

/**
 * Normalize JSON, form-encoded, or query-string callbacks into the official shape.
 */
function looksLikeUssd(req) {
  const raw = isEmptyBody(req.body) ? (req.query || {}) : req.body;
  if (!raw || typeof raw !== 'object') return false;
  return Boolean(raw.sessionID || raw.sessionId || raw.userData != null || raw.msisdn || raw.phoneNumber);
}

function normalizeRequest(req) {
  const raw = isEmptyBody(req.body) ? (req.query || {}) : req.body;
  const src = raw && typeof raw === 'object' ? raw : {};

  const newSessionHint = asBoolean(src.newSession);
  return {
    sessionID: src.sessionID || src.sessionId || '',
    userID: src.userID || src.userId || '',
    newSession: newSessionHint != null ? newSessionHint : src.type === 'initiation',
    msisdn: src.msisdn || src.phoneNumber || '',
    userData: src.userData != null ? src.userData : (src.text != null ? src.text : ''),
    network: src.network || '',
    serviceCode: src.serviceCode || src.service_code || '',
  };
}

function parseContinuePrefix(text) {
  const trimmed = String(text).trim();
  if (/^CON\b/i.test(trimmed)) {
    return { message: trimmed.replace(/^CON\s*/i, ''), continueSession: true };
  }
  if (/^END\b/i.test(trimmed)) {
    return { message: trimmed.replace(/^END\s*/i, ''), continueSession: false };
  }
  return { message: trimmed, continueSession: false };
}

function buildResponse(incoming, targetBody) {
  const sessionID = incoming?.sessionID || '';
  const userID = incoming?.userID || '';
  const msisdn = incoming?.msisdn || '';

  if (targetBody && typeof targetBody === 'object' && !Array.isArray(targetBody)
      && (targetBody.message != null || targetBody.continueSession != null)) {
    return {
      sessionID: targetBody.sessionID || sessionID,
      userID: targetBody.userID || userID,
      msisdn: targetBody.msisdn || msisdn,
      message: targetBody.message != null ? String(targetBody.message) : '',
      continueSession: Boolean(targetBody.continueSession),
    };
  }

  if (typeof targetBody === 'string' && targetBody.trim()) {
    const parsed = parseContinuePrefix(targetBody);
    return { sessionID, userID, msisdn, ...parsed };
  }

  return {
    sessionID,
    userID,
    msisdn,
    message: 'Service temporarily unavailable. Please try again.',
    continueSession: false,
  };
}

module.exports = { isEmptyBody, looksLikeUssd, normalizeRequest, buildResponse };
