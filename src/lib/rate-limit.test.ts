import { describe, it, expect } from 'vitest';
import { checkRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  const config = { maxRequests: 3, windowMs: 1000 };

  it('allows requests within limit', () => {
    const key = `test-allow-${Date.now()}`;
    expect(checkRateLimit(key, config).allowed).toBe(true);
    expect(checkRateLimit(key, config).allowed).toBe(true);
    expect(checkRateLimit(key, config).allowed).toBe(true);
  });

  it('blocks requests exceeding limit', () => {
    const key = `test-block-${Date.now()}`;
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    const result = checkRateLimit(key, config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns remaining count', () => {
    const key = `test-remaining-${Date.now()}`;
    const r1 = checkRateLimit(key, config);
    expect(r1.remaining).toBe(2);
    const r2 = checkRateLimit(key, config);
    expect(r2.remaining).toBe(1);
  });

  it('isolates different keys', () => {
    const key1 = `test-iso1-${Date.now()}`;
    const key2 = `test-iso2-${Date.now()}`;
    checkRateLimit(key1, config);
    checkRateLimit(key1, config);
    checkRateLimit(key1, config);
    // key1 is exhausted, key2 should still work
    expect(checkRateLimit(key2, config).allowed).toBe(true);
  });
});
