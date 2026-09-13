/**
 * Built-in incoming sources. Each appears as a "Receive from" option
 * and can carry a protocol mode (e.g. Arkesel USSD is request/response).
 */
const LIVE_MODES = new Set(['arkesel-ussd']);

const KNOWN_SOURCES = {
  '/webhook/arkesel-ussd': {
    name: 'Arkesel USSD',
    mode: 'arkesel-ussd',
  },
};

function displayNameFromPath(path) {
  const last = String(path || '').split('/').filter(Boolean).pop();
  if (!last || last === 'webhook') return path || '/webhook';
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function sourceMeta(path) {
  const known = KNOWN_SOURCES[path];
  if (known) return { path, name: known.name, mode: known.mode };
  return { path, name: displayNameFromPath(path), mode: 'webhook' };
}

function annotateEndpoint(ep) {
  const meta = sourceMeta(ep.path);
  return {
    ...ep,
    name: ep.name || meta.name,
    mode: ep.mode || meta.mode,
  };
}

function ensureKnownSources(endpoints) {
  const list = endpoints.map(annotateEndpoint);
  for (const path of Object.keys(KNOWN_SOURCES)) {
    if (!list.some(e => e.path === path)) {
      list.push(annotateEndpoint({ path, targets: null }));
    }
  }
  return list;
}

function endpointLabel(ep) {
  return ep.name || sourceMeta(ep.path).name;
}

function isArkeselUssd(endpointPath) {
  return sourceMeta(endpointPath).mode === 'arkesel-ussd';
}

function isLiveEndpoint(epOrPath) {
  const path = typeof epOrPath === 'string' ? epOrPath : epOrPath?.path;
  const mode = typeof epOrPath === 'object' && epOrPath ? epOrPath.mode : undefined;
  return LIVE_MODES.has(mode || sourceMeta(path).mode);
}

module.exports = {
  KNOWN_SOURCES,
  LIVE_MODES,
  sourceMeta,
  annotateEndpoint,
  ensureKnownSources,
  endpointLabel,
  isArkeselUssd,
  isLiveEndpoint,
};
