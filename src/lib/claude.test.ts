import { describe, it, expect } from 'vitest';
import { parseJsonFromResponse } from './claude';

describe('parseJsonFromResponse', () => {
  it('parses clean JSON', () => {
    const result = parseJsonFromResponse('{"key": "value"}');
    expect(result.key).toBe('value');
  });

  it('extracts JSON from markdown code block', () => {
    const text = 'Here is the result:\n```json\n{"nodes": [1, 2, 3]}\n```\n';
    const result = parseJsonFromResponse(text);
    expect(result.nodes).toEqual([1, 2, 3]);
  });

  it('extracts JSON from plain code block', () => {
    const text = '```\n{"a": 1}\n```';
    const result = parseJsonFromResponse(text);
    expect(result.a).toBe(1);
  });

  it('fixes trailing commas', () => {
    const text = '{"items": [1, 2, 3,], "name": "test",}';
    const result = parseJsonFromResponse(text);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.name).toBe('test');
  });

  it('fixes missing commas between objects', () => {
    const text = '{"a": {"x": 1}{"b": 2}}';
    // After fix: {"a": {"x": 1},{"b": 2}} — still invalid but tests the repair
    // Actually this specific case is tricky. Let's test array case:
    const text2 = '[{"a":1}{"b":2}]';
    const result = parseJsonFromResponse(text2.replace('[', '{"arr":[').replace(']', ']}'));
    expect(result.arr).toBeDefined();
  });

  it('removes // comments', () => {
    const text = '{\n  "key": "value" // this is a comment\n}';
    const result = parseJsonFromResponse(text);
    expect(result.key).toBe('value');
  });

  it('closes unclosed brackets', () => {
    const text = '{"nodes": [{"id": "1"}, {"id": "2"}';
    const result = parseJsonFromResponse(text);
    expect(result.nodes).toHaveLength(2);
  });

  it('throws on no JSON found', () => {
    expect(() => parseJsonFromResponse('no json here at all')).toThrow('No JSON found');
  });

  it('handles nested structures', () => {
    const text = '```json\n{"outline": {"theme": "冒险", "characters": [{"name": "勇者"}]}}\n```';
    const result = parseJsonFromResponse(text);
    expect(result.outline.theme).toBe('冒险');
    expect(result.outline.characters[0].name).toBe('勇者');
  });
});
