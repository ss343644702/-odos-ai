// LLM API Client - DeepSeek direct API (primary) + MiniMax (fallback)
// With: tracing, retry with exponential backoff

import { generateTraceId, estimateTokens, recordTrace } from './trace';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_API_URL = 'https://api.minimaxi.chat/v1/text/chatcompletion_v2';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ──────────────────────────────────────────────
// Retry + fallback configuration
// ──────────────────────────────────────────────

const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 1000;

function isTransientError(status: number, errorText: string): boolean {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (errorText.includes('ECONNRESET') || errorText.includes('ETIMEDOUT')) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────
// Core fetch with retry (works for both DeepSeek and MiniMax)
// ──────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  traceId: string,
  skill?: string,
): Promise<{ content: string; model: string }> {
  const model = body.model as string;
  const inputTokens = estimateTokens(JSON.stringify(body.messages));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (attempt < MAX_RETRIES && isTransientError(response.status, errorText)) {
          recordTrace({
            traceId, skill, model, inputTokensEstimate: inputTokens, outputTokensEstimate: 0,
            latencyMs: Date.now() - start, status: 'retry',
            error: `${response.status}: ${errorText.slice(0, 200)}`,
            retryCount: attempt + 1, timestamp: new Date().toISOString(),
          });
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }
        recordTrace({
          traceId, skill, model, inputTokensEstimate: inputTokens, outputTokensEstimate: 0,
          latencyMs: Date.now() - start, status: 'error',
          error: `${response.status}: ${errorText.slice(0, 200)}`,
          retryCount: attempt, timestamp: new Date().toISOString(),
        });
        throw new Error(`${model} API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content || '';
      recordTrace({
        traceId, skill, model, inputTokensEstimate: inputTokens,
        outputTokensEstimate: estimateTokens(content),
        latencyMs: Date.now() - start, status: 'success',
        retryCount: attempt, timestamp: new Date().toISOString(),
      });
      return { content, model };
    } catch (error: any) {
      if (error.message?.includes('API error')) throw error;
      if (attempt < MAX_RETRIES) {
        recordTrace({
          traceId, skill, model, inputTokensEstimate: inputTokens, outputTokensEstimate: 0,
          latencyMs: Date.now() - start, status: 'retry',
          error: error.message?.slice(0, 200), retryCount: attempt + 1,
          timestamp: new Date().toISOString(),
        });
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
        continue;
      }
      recordTrace({
        traceId, skill, model, inputTokensEstimate: inputTokens, outputTokensEstimate: 0,
        latencyMs: Date.now() - start, status: 'error',
        error: error.message?.slice(0, 200), retryCount: attempt,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }
  throw new Error(`${model}: max retries exceeded`);
}

// ──────────────────────────────────────────────
// Public API: callLLM — DeepSeek → MiniMax fallback
// ──────────────────────────────────────────────

export async function callLLM(params: {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  skill?: string;
}): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userMessage },
  ];
  const traceId = generateTraceId();

  try {
    const { content } = await fetchWithRetry(
      DEEPSEEK_API_URL, DEEPSEEK_API_KEY,
      { model: DEEPSEEK_MODEL, messages, temperature: params.temperature || 0.7, max_tokens: params.maxTokens || 4096 },
      traceId, params.skill,
    );
    return content;
  } catch {
    if (!MINIMAX_API_KEY) throw new Error('DeepSeek failed and no MiniMax fallback configured');
    console.log(`[LLM fallback] DeepSeek failed, trying MiniMax | ${traceId}`);
    const { content } = await fetchWithRetry(
      MINIMAX_API_URL, MINIMAX_API_KEY,
      { model: 'MiniMax-Text-01', messages, temperature: params.temperature || 0.7, max_tokens: params.maxTokens || 4096 },
      traceId + '_fallback', params.skill,
    );
    return content;
  }
}

// Stream version for real-time responses
export async function callLLMStream(params: {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  onChunk: (text: string) => void;
  onDone: () => void;
}): Promise<void> {
  const messages: ChatMessage[] = [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userMessage },
  ];
  const traceId = generateTraceId();
  const start = Date.now();

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL, messages,
      temperature: params.temperature || 0.7, max_tokens: params.maxTokens || 4096, stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    recordTrace({
      traceId, model: DEEPSEEK_MODEL, inputTokensEstimate: estimateTokens(JSON.stringify(messages)),
      outputTokensEstimate: 0, latencyMs: Date.now() - start,
      status: 'error', error: `Stream error: ${response.status}`, timestamp: new Date().toISOString(),
    });
    throw new Error(`DeepSeek stream error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullOutput = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          recordTrace({
            traceId, model: DEEPSEEK_MODEL, inputTokensEstimate: estimateTokens(JSON.stringify(messages)),
            outputTokensEstimate: estimateTokens(fullOutput), latencyMs: Date.now() - start,
            status: 'success', timestamp: new Date().toISOString(),
          });
          params.onDone();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) { fullOutput += content; params.onChunk(content); }
        } catch { /* skip */ }
      }
    }
  }

  recordTrace({
    traceId, model: DEEPSEEK_MODEL, inputTokensEstimate: estimateTokens(JSON.stringify(messages)),
    outputTokensEstimate: estimateTokens(fullOutput), latencyMs: Date.now() - start,
    status: 'success', timestamp: new Date().toISOString(),
  });
  params.onDone();
}

// Multi-turn call — accepts full message array
export async function callLLMMultiTurn(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  skill?: string;
}): Promise<string> {
  const traceId = generateTraceId();
  const { content } = await fetchWithRetry(
    DEEPSEEK_API_URL, DEEPSEEK_API_KEY,
    { model: params.model || DEEPSEEK_MODEL, messages: params.messages, temperature: params.temperature ?? 0.3, max_tokens: params.maxTokens ?? 2048 },
    traceId, params.skill || 'multi_turn',
  );
  return content;
}

// ReAct agent call
export async function callDeepSeek(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const traceId = generateTraceId();
  const { content } = await fetchWithRetry(
    DEEPSEEK_API_URL, DEEPSEEK_API_KEY,
    { model: params.model || DEEPSEEK_MODEL, messages: params.messages, temperature: params.temperature ?? 0.3, max_tokens: params.maxTokens ?? 2048 },
    traceId, 'react_agent',
  );
  return content;
}

// ============================================================
// JSON Parser with repair heuristics
// ============================================================

export function parseJsonFromResponse(text: string): any {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
  let jsonStr: string;
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const startIdx = text.indexOf('{');
    if (startIdx === -1) throw new Error('No JSON found in response');
    jsonStr = text.slice(startIdx).trim();
  }

  try { return JSON.parse(jsonStr); } catch {}
  try { return JSON.parse(repairTruncatedJson(jsonStr)); } catch {}

  let cleaned = jsonStr;
  cleaned = cleaned.replace(/:\s*\*\*([^*\n]*)\*\*/g, ': "$1"');
  cleaned = cleaned.replace(/\*\*/g, '');
  cleaned = cleaned.replace(/\/\/[^\n]*/g, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
  cleaned = cleaned.replace(/\}(\s*)\{/g, '},$1{');
  cleaned = cleaned.replace(/\](\s*)\[/g, '],$1[');
  cleaned = cleaned.replace(/(\}|\])(\s*\n\s*)"(?=[a-zA-Z_])/g, '$1,$2"');
  cleaned = cleaned.replace(/"(\s*\n\s*)"(?=[a-zA-Z_])/g, '",$1"');

  try { return JSON.parse(cleaned); } catch {}
  try { return JSON.parse(repairTruncatedJson(cleaned)); } catch {}

  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][\w]*)\s*:/g, '$1"$2":');
  cleaned = cleaned.replace(
    /("[\w\u4e00-\u9fff]+")\s*:\s*(?!["'{\[\d\-tfn])([^\n,\]}"[\]]+)/g,
    (_, key, val) => `${key}: "${val.trim()}"`,
  );

  try {
    return JSON.parse(repairTruncatedJson(cleaned));
  } catch (e: any) {
    try {
      const fs = require('fs');
      fs.writeFileSync('/tmp/llm-json-fail.txt',
        `=== RAW ===\n${text.slice(0, 2000)}\n\n=== CLEANED ===\n${cleaned.slice(0, 2000)}\n\n=== ERROR ===\n${e.message}\n`);
    } catch {}
    throw new Error(`JSON parse failed after repair: ${e.message}`);
  }
}

function repairTruncatedJson(json: string): string {
  let s = json;
  let inString = false;
  let lastStringStart = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) {
      inString = !inString;
      if (inString) lastStringStart = i;
    }
  }
  if (inString && lastStringStart >= 0) {
    const beforeString = s.slice(0, lastStringStart);
    const beforeTrimmed = beforeString.trimEnd();
    if (beforeTrimmed.endsWith(':')) {
      const lastComma = beforeTrimmed.lastIndexOf(',');
      const lastBracket = Math.max(beforeTrimmed.lastIndexOf('{'), beforeTrimmed.lastIndexOf('['));
      s = s.slice(0, Math.max(lastComma, lastBracket) + 1);
    } else if (beforeTrimmed.endsWith(',') || beforeTrimmed.endsWith('[') || beforeTrimmed.endsWith('{')) {
      s = beforeTrimmed;
    } else {
      s += '"';
    }
  }
  s = s.replace(/,\s*$/, '');
  const stack: string[] = [];
  inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) { inString = !inString; continue; }
    if (inString) continue;
    if (s[i] === '{' || s[i] === '[') stack.push(s[i]);
    else if (s[i] === '}' || s[i] === ']') stack.pop();
  }
  while (stack.length > 0) {
    const opener = stack.pop();
    s += opener === '{' ? '}' : ']';
  }
  return s;
}
