/**
 * Cookie-based session utilities using HMAC-SHA256 signed tokens.
 * No extra dependencies — uses Node's built-in crypto module.
 */
const crypto = require('crypto');
const config = require('../config');

const COOKIE_NAME = 'wf_session';
const MAX_AGE_MS  = 24 * 60 * 60 * 1000; // 24 h

function sign(payload) {
  return crypto
    .createHmac('sha256', config.admin.sessionSecret)
    .update(payload)
    .digest('hex');
}

function createToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, iat: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  if (sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() - data.iat > MAX_AGE_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  return (req.headers.cookie || '').split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) acc[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    return acc;
  }, {});
}

/** Returns the decoded session payload, or null if not authenticated. */
function getSession(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE_NAME] || '');
}

/** Sets a signed session cookie. */
function setSession(res, email) {
  const token = createToken(email);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

/** Clears the session cookie. */
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

module.exports = { COOKIE_NAME, getSession, setSession, clearSession };
