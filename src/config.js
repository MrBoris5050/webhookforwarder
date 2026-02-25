/**
 * Configuration management
 * Loads from environment variables with fallback to config.json
 */
const fs = require('fs');
const path = require('path');

function loadConfigFile() {
  const configPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.warn(`[config] Failed to parse config.json: ${err.message}`);
    }
  }
  return {};
}

function parseTargetHeaders(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    console.warn('[config] TARGET_HEADERS is not valid JSON, ignoring.');
    return {};
  }
}

function parseRetryConfig(raw) {
  const defaults = { maxAttempts: 3, delays: [1000, 3000, 9000] };
  if (!raw) return defaults;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function buildTargets(fileConfig, env) {
  // File-based targets take precedence for complex configs
  if (fileConfig.targets && Array.isArray(fileConfig.targets)) {
    return fileConfig.targets.map((t, i) => ({
      id: t.id || `target-${i + 1}`,
      url: t.url,
      headers: t.headers || {},
      auth: t.auth || null,
      transform: t.transform || null,
      rateLimit: t.rateLimit || null,
      enabled: t.enabled !== false,
      signature: t.signature || null,
      // endpoints: which receiver paths forward to this target; [] = all
      endpoints: Array.isArray(t.endpoints) ? t.endpoints : [],
    }));
  }

  // Fall back to env var TARGET_URLS
  const urls = (env.TARGET_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
  const headers = parseTargetHeaders(env.TARGET_HEADERS);

  return urls.map((url, i) => {
    const n = i + 1;
    const sigHeader = env[`TARGET_${n}_SIGNATURE_HEADER`];
    const sigSecret = env[`TARGET_${n}_SIGNATURE_SECRET`];
    const sigAlg = env[`TARGET_${n}_SIGNATURE_ALGORITHM`];
    const signature = (sigHeader && sigSecret)
      ? { header: sigHeader, secret: sigSecret, algorithm: sigAlg || 'sha256' }
      : null;
    // TARGET_N_ENDPOINTS: comma-separated list of endpoint paths, empty = all
    const epRaw = env[`TARGET_${n}_ENDPOINTS`] || '';
    const endpoints = epRaw.split(',').map(p => p.trim()).filter(Boolean);
    const targetId = `target-${n}`;
    return {
      id: targetId,
      url,
      headers: headers[targetId] || headers[url] || {},
      auth: null,
      transform: null,
      rateLimit: null,
      enabled: true,
      signature,
      endpoints,
    };
  });
}

/**
 * Build the list of webhook receiver endpoints.
 *
 * Priority (highest → lowest):
 *   1. config.json `endpoints` array  – full control, per-endpoint target overrides
 *   2. WEBHOOK_PATHS env var           – comma-separated extra paths, all use global targets
 *   3. WEBHOOK_PATH / webhookPath      – single primary path (legacy / default)
 */
function buildEndpoints(fileConfig, env) {
  // File-based endpoints with optional per-endpoint target lists
  if (fileConfig.endpoints && Array.isArray(fileConfig.endpoints)) {
    return fileConfig.endpoints.map((ep, epIdx) => ({
      path: ep.path,
      // null means "inherit global targets" at runtime
      targets: ep.targets
        ? ep.targets.map((t, i) => ({
            id: t.id || `ep${epIdx + 1}-target-${i + 1}`,
            url: t.url,
            headers: t.headers || {},
            auth: t.auth || null,
            transform: t.transform || null,
            rateLimit: t.rateLimit || null,
            enabled: t.enabled !== false,
            signature: t.signature || null,
            endpoints: Array.isArray(t.endpoints) ? t.endpoints : [],
          }))
        : null,
    }));
  }

  // Build from env vars
  const primaryPath = env.WEBHOOK_PATH || fileConfig.webhookPath || '/webhook';
  const extraPaths = (env.WEBHOOK_PATHS || '')
    .split(',')
    .map(p => p.trim())
    .filter(p => p && p !== primaryPath);

  return [
    { path: primaryPath, targets: null },
    ...extraPaths.map(path => ({ path, targets: null })),
  ];
}

function loadConfig() {
  const fileConfig = loadConfigFile();
  const env = process.env;

  const targets = buildTargets(fileConfig, env);
  const endpoints = buildEndpoints(fileConfig, env);

  return {
    port: parseInt(env.PORT || fileConfig.port || '3000', 10),
    // Primary webhook path kept for backward compat (equals endpoints[0].path)
    webhookPath: endpoints[0]?.path || env.WEBHOOK_PATH || fileConfig.webhookPath || '/webhook',
    endpoints,
    targets,

    retry: parseRetryConfig(env.RETRY_CONFIG || fileConfig.retry),

    timeout: parseInt(env.REQUEST_TIMEOUT_MS || fileConfig.timeoutMs || '10000', 10),

    signature: {
      enabled: (env.SIGNATURE_VERIFY === 'true') || fileConfig.signature?.enabled || false,
      secret: env.SIGNATURE_SECRET || fileConfig.signature?.secret || '',
      header: env.SIGNATURE_HEADER || fileConfig.signature?.header || 'x-hub-signature-256',
      algorithm: env.SIGNATURE_ALGORITHM || fileConfig.signature?.algorithm || 'sha256',
    },

    admin: {
      enabled: true,
      email: env.ADMIN_EMAIL || fileConfig.admin?.email || 'admin@localhost',
      username: env.ADMIN_USERNAME || fileConfig.admin?.username || 'admin',
      password: env.ADMIN_PASSWORD || fileConfig.admin?.password || 'changeme',
      authRequired: (env.ADMIN_AUTH_REQUIRED !== 'false') && (fileConfig.admin?.authRequired !== false),
      sessionSecret: env.SESSION_SECRET || fileConfig.admin?.sessionSecret || 'default-secret-change-me',
    },

    store: {
      maxWebhooks: parseInt(env.MAX_STORED_WEBHOOKS || fileConfig.store?.maxWebhooks || '200', 10),
      maxDLQ: parseInt(env.MAX_DLQ_ENTRIES || fileConfig.store?.maxDLQ || '500', 10),
      mongodbUri: env.MONGODB_URI || fileConfig.store?.mongodbUri || null,
    },

    logLevel: env.LOG_LEVEL || fileConfig.logLevel || 'info',
  };
}

const config = loadConfig();

module.exports = config;
