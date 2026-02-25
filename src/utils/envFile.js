/**
 * Utility for reading and updating .env files in-place.
 * Preserves existing comments, blank lines, and keys we don't touch.
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(process.cwd(), '.env');

/**
 * Read the .env file and return a Map of key → value (raw, unquoted).
 * Returns an empty Map if the file doesn't exist.
 */
function readEnvFile() {
  const map = new Map();
  if (!fs.existsSync(ENV_PATH)) return map;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    map.set(key, val);
  }
  return map;
}

/**
 * Update (or add) a set of key=value pairs in the .env file.
 * Existing keys are updated in-place; new keys are appended.
 * Comments and blank lines are preserved.
 *
 * @param {Object} updates - { KEY: 'value', ... }
 */
function updateEnvFile(updates) {
  const updatesMap = new Map(Object.entries(updates));
  const touched = new Set();

  let lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8').split('\n')
    : [];

  // Update existing lines in-place
  lines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (updatesMap.has(key)) {
      touched.add(key);
      return `${key}=${updatesMap.get(key)}`;
    }
    return line;
  });

  // Append any keys that weren't already in the file
  for (const [key, val] of updatesMap) {
    if (!touched.has(key)) {
      lines.push(`${key}=${val}`);
    }
  }

  // Remove trailing blank lines then write
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

module.exports = { readEnvFile, updateEnvFile, ENV_PATH };
