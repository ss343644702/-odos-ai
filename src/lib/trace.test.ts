import { describe, it, expect } from 'vitest';
import { estimateTokens, generateTraceId, recordTrace, getRecentTraces, getTraceStats } from './trace';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates English tokens (~4 chars per token)', () => {
    const result = estimateTokens('hello world'); // 11 chars → ~3 tokens
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  it('estimates Chinese tokens (~1.5 chars per token)', () => {
    const result = estimateTokens('你好世界测试'); // 6 Chinese chars → ~4 tokens
    expect(result).toBeGreaterThan(2);
    expect(result).toBeLessThan(10);
  });
});

describe('generateTraceId', () => {
  it('returns a string starting with tr_', () => {
    expect(generateTraceId()).toMatch(/^tr_\d+_[a-z0-9]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('recordTrace + getRecentTraces + getTraceStats', () => {
  it('records and retrieves traces', () => {
    const traceId = generateTraceId();
    recordTrace({
      traceId,
      model: 'test-model',
      skill: 'test-skill',
      inputTokensEstimate: 100,
      outputTokensEstimate: 50,
      latencyMs: 500,
      status: 'success',
      timestamp: new Date().toISOString(),
    });

    const traces = getRecentTraces(10);
    expect(traces.some(t => t.traceId === traceId)).toBe(true);
  });

  it('returns stats', () => {
    const stats = getTraceStats();
    expect(stats.totalCalls).toBeGreaterThan(0);
    expect(typeof stats.avgLatencyMs).toBe('number');
  });
});
