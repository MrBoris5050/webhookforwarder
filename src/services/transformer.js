/**
 * Payload transformer
 * Supports simple {{variable}} template substitution on JSON payloads.
 *
 * A target's `transform` config is a plain object acting as a template.
 * Leaf string values may contain {{path.to.value}} placeholders resolved
 * against the original payload.
 *
 * Example transform config:
 *   {
 *     "text": "New event: {{event}} from {{data.source}}",
 *     "value": "{{amount}}"
 *   }
 */

/**
 * Safely reads a nested value from an object using dot notation.
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return '';
    return acc[key];
  }, obj);
}

/**
 * Recursively replaces {{placeholders}} in template strings with values from data.
 */
function resolveTemplate(template, data) {
  if (typeof template === 'string') {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const val = getNestedValue(data, path.trim());
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  if (Array.isArray(template)) {
    return template.map(item => resolveTemplate(item, data));
  }

  if (template && typeof template === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = resolveTemplate(value, data);
    }
    return result;
  }

  return template;
}

/**
 * Apply a transform config to a payload.
 * Returns the transformed payload, or the original if no transform is defined.
 *
 * @param {Object|null} transformConfig - target.transform from config
 * @param {*} payload - original request body
 * @returns {*}
 */
function applyTransform(transformConfig, payload) {
  if (!transformConfig) return payload;
  return resolveTemplate(transformConfig, payload);
}

module.exports = { applyTransform, resolveTemplate, getNestedValue };
