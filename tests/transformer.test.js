const { applyTransform, resolveTemplate, getNestedValue } = require('../src/services/transformer');

describe('transformer', () => {
  describe('getNestedValue', () => {
    it('returns a top-level property', () => {
      expect(getNestedValue({ foo: 'bar' }, 'foo')).toBe('bar');
    });

    it('returns a nested property using dot notation', () => {
      expect(getNestedValue({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
    });

    it('returns empty string for missing path', () => {
      expect(getNestedValue({ a: 1 }, 'a.b.c')).toBe('');
    });

    it('handles null parent gracefully', () => {
      expect(getNestedValue(null, 'foo')).toBe('');
    });
  });

  describe('resolveTemplate', () => {
    const data = { event: 'push', repo: { name: 'my-repo' }, count: 5 };

    it('replaces single placeholder', () => {
      expect(resolveTemplate('Event: {{event}}', data)).toBe('Event: push');
    });

    it('replaces nested placeholder', () => {
      expect(resolveTemplate('Repo: {{repo.name}}', data)).toBe('Repo: my-repo');
    });

    it('replaces multiple placeholders in one string', () => {
      expect(resolveTemplate('{{event}} on {{repo.name}}', data)).toBe('push on my-repo');
    });

    it('replaces placeholders in object values recursively', () => {
      const template = { text: 'Event: {{event}}', repo: '{{repo.name}}' };
      expect(resolveTemplate(template, data)).toEqual({ text: 'Event: push', repo: 'my-repo' });
    });

    it('replaces placeholders in array items', () => {
      const template = ['{{event}}', '{{repo.name}}'];
      expect(resolveTemplate(template, data)).toEqual(['push', 'my-repo']);
    });

    it('returns non-string/non-object primitives unchanged', () => {
      expect(resolveTemplate(42, data)).toBe(42);
      expect(resolveTemplate(true, data)).toBe(true);
      expect(resolveTemplate(null, data)).toBeNull();
    });

    it('uses empty string for unknown placeholders', () => {
      expect(resolveTemplate('{{unknown}}', data)).toBe('');
    });
  });

  describe('applyTransform', () => {
    it('returns the original payload when no transform is configured', () => {
      const payload = { a: 1 };
      expect(applyTransform(null, payload)).toBe(payload);
      expect(applyTransform(undefined, payload)).toBe(payload);
    });

    it('applies a transform template to the payload', () => {
      const transform = { message: 'Got {{event}} from {{source}}' };
      const payload = { event: 'click', source: 'web' };
      expect(applyTransform(transform, payload)).toEqual({ message: 'Got click from web' });
    });

    it('handles deeply nested transform templates', () => {
      const transform = { wrapper: { inner: '{{value}}' } };
      const payload = { value: 'hello' };
      expect(applyTransform(transform, payload)).toEqual({ wrapper: { inner: 'hello' } });
    });
  });
});
