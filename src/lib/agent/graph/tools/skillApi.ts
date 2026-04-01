/**
 * Shared skill API caller for server-side tools.
 * Used by generation.ts and cocreation.ts.
 */

import type { RunnableConfig } from '@langchain/core/runnables';

export function getBaseUrl(config?: RunnableConfig): string {
  // Prefer serverOrigin from config (derived from actual request host/port)
  const origin = (config?.configurable as any)?.serverOrigin;
  if (origin) return origin;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

const STREAMABLE_SKILLS = new Set([
  'outlineGenerator', 'branchGenerator', 'entityExtractor',
  'storyboardGenerator', 'voiceGenerator', 'expandNode',
]);

export async function callSkillAPI(
  skill: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  config?: RunnableConfig,
): Promise<any> {
  const baseUrl = getBaseUrl(config);

  if (STREAMABLE_SKILLS.has(skill)) {
    try {
      const res = await fetch(`${baseUrl}/api/generate-story-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, input }),
        signal,
      });
      if (!res.ok || !res.body) return callSkillAPINonStream(skill, input, signal, config);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          try {
            const event = JSON.parse(dataStr);
            if (event.type === 'done') result = event.result;
            else if (event.type === 'error') throw new Error(event.message);
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }
      if (!result) throw new Error(`Skill ${skill}: no result from stream`);
      return result;
    } catch (err) {
      return callSkillAPINonStream(skill, input, signal, config);
    }
  }

  return callSkillAPINonStream(skill, input, signal, config);
}

async function callSkillAPINonStream(
  skill: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  config?: RunnableConfig,
): Promise<any> {
  const baseUrl = getBaseUrl(config);
  const res = await fetch(`${baseUrl}/api/generate-story`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill, input }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'API call failed' }));
    throw new Error(err.error || `Skill ${skill} failed`);
  }
  return res.json();
}
