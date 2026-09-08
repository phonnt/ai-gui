import { describe, expect, test } from 'bun:test';
import { brandFor, brandKeyFor, fallbackHue } from './providerIcons';

describe('provider brand mapping', () => {
  test('resolves known brands with real SVG paths', () => {
    expect(brandFor('anthropic')?.title).toBe('Anthropic');
    expect(brandFor('OpenAI')?.title).toBe('OpenAI');
    expect(brandFor('opencode-zen') ?? null).toBeNull();
  });

  test('matches brand substrings case-insensitively', () => {
    expect(brandKeyFor('ANTHROPIC')).toBe('anthropic');
    expect(brandKeyFor('my-google-proxy')).toBe('google');
    expect(brandKeyFor('opencode-zen')).toBeNull();
  });

  test('fallback hue is deterministic', () => {
    expect(fallbackHue('opencode-zen')).toBe(fallbackHue('opencode-zen'));
    expect(fallbackHue('a')).not.toBeNaN();
  });
});
