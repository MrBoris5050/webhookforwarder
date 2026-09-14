/**
 * Split the shared Arkesel parent code from WiFi sub-extensions.
 *
 *   *928*122#      → original parent app
 *   *928*122*2#    → this WiFi app
 *   *928*122*12#   → same WiFi app (tenant chosen later by extension)
 *
 * Arkesel treats *928*122*12# as the parent code plus first input "12".
 * Without this router both apps get the POST and the parent reply wins.
 */

const PARENT_CODE = process.env.USSD_PARENT_CODE || '*928*122#';
const SESSION_TTL_MS = 20 * 60 * 1000;
const sessions = new Map();

function strip(value) {
  return String(value || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/\uFF0A/g, '*')
    .replace(/[#\uFF03]+$/g, '');
}

function parentCode() {
  return strip(PARENT_CODE);
}

function matchTokens(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function looksLikeWifiTarget(target) {
  if (!target) return false;
  if (target.ussdRoute === 'wifi') return true;
  if (target.ussdRoute === 'parent') return false;
  const url = String(target.url || '').toLowerCase();
  const parentTokens = matchTokens(process.env.USSD_PARENT_TARGET_MATCH);
  if (parentTokens.some((token) => url.includes(token))) return false;
  const wifiTokens = matchTokens(process.env.USSD_WIFI_TARGET_MATCH || 'wifi-ussd,:3040');
  return wifiTokens.some((token) => url.includes(token));
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, row] of sessions) {
    if (now - row.at > SESSION_TTL_MS) sessions.delete(id);
  }
}

function remember(sessionID, route, targetId) {
  if (!sessionID) return;
  sessions.set(sessionID, { route, targetId, at: Date.now() });
}

function recall(sessionID) {
  if (!sessionID) return null;
  pruneSessions();
  const row = sessions.get(sessionID);
  if (!row) return null;
  row.at = Date.now();
  return row;
}

function extensionFromDial(incoming) {
  const userData = strip(incoming.userData);
  const service = strip(incoming.serviceCode);
  const parent = parentCode();

  for (const raw of [userData, service]) {
    if (raw.startsWith(`${parent}*`)) {
      return raw.slice(parent.length + 1);
    }
  }
  if (incoming.newSession && /^\d+$/.test(userData)) {
    return userData;
  }
  return '';
}

function classify(incoming) {
  if (extensionFromDial(incoming)) return 'wifi';

  const userData = strip(incoming.userData);
  const service = strip(incoming.serviceCode);
  const parent = parentCode();
  if (userData === parent || service === parent || (incoming.newSession && !userData)) {
    return 'parent';
  }

  const remembered = recall(incoming.sessionID);
  if (remembered?.route && !incoming.newSession) return remembered.route;
  return remembered?.route || null;
}

function filterTargets(targets, route, sessionID, incoming = {}) {
  const remembered = recall(sessionID);
  const canPin = remembered?.targetId && remembered.route === route && !incoming.newSession;
  if (canPin) {
    const pinned = targets.filter((t) => t.id === remembered.targetId);
    if (pinned.length) return pinned;
  }

  if (!route) return targets;
  const wifi = targets.filter(looksLikeWifiTarget);
  const parent = targets.filter((t) => !looksLikeWifiTarget(t));
  if (route === 'wifi') return wifi;
  if (route === 'parent') return parent;
  return targets;
}

function usableBody(body) {
  if (body == null) return false;
  if (typeof body === 'object' && body.ignored) return false;
  if (typeof body === 'object') return String(body.message || '').trim().length > 0;
  return String(body).trim().length > 0;
}

function looksLikeWifiMenu(body) {
  return /buy wifi|recent purchases|wifi voucher/i.test(String(body?.message || body || ''));
}

function looksLikeParentMenu(body) {
  return /gh checkers|waec|wassce|bece/i.test(String(body?.message || body || ''));
}

function pickResponse(results, targets, route) {
  const ok = results
    .map((result, index) => ({
      target: targets[index],
      body: result.status === 'fulfilled' ? result.value?.body : null,
      success: result.status === 'fulfilled' && result.value?.success,
    }))
    .filter((item) => item.success && usableBody(item.body));

  if (!ok.length) return { body: null, targetId: null };

  let chosen = null;
  if (route === 'wifi') {
    chosen = ok.find((item) => looksLikeWifiMenu(item.body) && !looksLikeParentMenu(item.body))
      || ok.find((item) => looksLikeWifiTarget(item.target) && !looksLikeParentMenu(item.body))
      || ok.find((item) => !looksLikeParentMenu(item.body));
  } else if (route === 'parent') {
    chosen = ok.find((item) => !looksLikeWifiTarget(item.target) && !looksLikeWifiMenu(item.body));
  } else {
    chosen = ok[0];
  }

  if (!chosen) return { body: null, targetId: null };
  return { body: chosen.body, targetId: chosen.target?.id || null };
}

function resetForTests() {
  sessions.clear();
}

module.exports = {
  classify,
  filterTargets,
  pickResponse,
  remember,
  recall,
  looksLikeWifiTarget,
  extensionFromDial,
  resetForTests,
  parentCode,
};
