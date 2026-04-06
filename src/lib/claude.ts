// LLM API Client - Using OpenRouter SDK
// With: tracing, retry with exponential backoff, MiniMax fallback

import { OpenRouter } from '@openrouter/sdk';
import { generateTraceId, estimateTokens, recordTrace } from './trace';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = 'deepseek/deepseek-chat-v3';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_API_URL = 'https://api.minimaxi.chat/v1/text/chatcompletion_v2';

// Shared OpenRouter client instance
const openrouter = new OpenRouter({ apiKey: OPENROUTER_API_KEY });

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ──────────────────────────────────────────────
// Retry + fallback configuration
// ──────────────────────────────────────────────

const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 1000;

/** Determine if an error is transient (worth retrying) */
function isTransientError(status: number, errorText: string): boolean {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (errorText.includes('ECONNRESET') || errorText.includes('ETIMEDOUT')) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────
// MiniMax fallback fetch (kept as raw fetch)
// ──────────────────────────────────────────────

async function fetchMiniMax(
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  traceId: string,
  skill?: string,
): Promise<string> {
  const model = 'MiniMax-Text-01';
  const inputTokens = estimateTokens(JSON.stringify(messages));
  const start = Date.now();

  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    recordTrace({
      traceId, skill, model, inputTokensEstimate: inputTokens, outputTokensEstimate: 0,
      latencyMs: Date.now() - start, status: 'error',
      error: `${response.status}: ${errorText.slice(0, 200)}`,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`MiniMax API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '';
  recordTrace({
    traceId, skill, model, inputTokensEstimate: inputTokens,
    outputTokensEstimate: estimateTokens(content),
    latencyMs: Date.now() - start, status: 'success',
    timestamp: new Date().toISOString(),
  });
  return content;
}

// ──────────────────────────────────────────────
// OpenRouter SDK call with retry
// ──────────────────────────────────────────────

async function callOpenRouter(
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  traceId: string,
  skill?: string,
  model?: string,
): Promise<string> {
  const modelId = model || OPENROUTER_MODEL;
  const inputTokens = estimateTokens(JSON.stringify(messages));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const result = openrouter.callModel({
        model: modelId,
        instructions: messages.find(m => m.role === 'system')?.content,
        input: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        temperature,
        maxOutputTokens: maxTokens,
      });

      const text = await result.getText();

      recordTrace({
        traceId, skill, model: modelId, inputTokensEstimate: inputTokens,
        outputTokensEstimate: estimateTokens(text),
        latencyMs: Date.now() - start, status: 'success', retryCount: attempt,
        timestamp: new Date().toISOString(),
      });

      return text;
    } catch (err: any) {
      const errMsg = err.message || String(err);
      const status = err.status || 0;

      if (attempt < MAX_RETRIES && isTransientError(status, errMsg)) {
        recordTrace({
          traceId, skill, model: modelId, inputTokensEstimate: inputTokens,
          outputTokensEstimate: 0, latencyMs: Date.now() - start,
          status: 'retry', error: errMsg.slice(0, 200), retryCount: attempt + 1,
          timestamp: new Date().toISOString(),
        });
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
        continue;
      }

      recordTrace({
        traceId, skill, model: modelId, inputTokensEstimate: inputTokens,
        outputTokensEstimate: 0, latencyMs: Date.now() - start,
        status: 'error', error: errMsg.slice(0, 200), retryCount: attempt,
        timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  throw new Error(`${modelId}: max retries exceeded`);
}

// ──────────────────────────────────────────────
// OpenRouter SDK streaming call
// ──────────────────────────────────────────────

async function streamOpenRouter(
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
  traceId: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  model?: string,
): Promise<void> {
  const modelId = model || OPENROUTER_MODEL;
  const inputTokens = estimateTokens(JSON.stringify(messages));
  const start = Date.now();

  try {
    const result = openrouter.callModel({
      model: modelId,
      instructions: messages.find(m => m.role === 'system')?.content,
      input: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      temperature,
      maxOutputTokens: maxTokens,
    });

    let fullText = '';

    // Use items-based streaming (replace by ID, don't accumulate)
    for await (const item of result.getItemsStream()) {
      if (item.type === 'message') {
        const textContent = item.content?.find((c: { type: string }) => c.type === 'output_text');
        if (textContent && 'text' in textContent) {
          const newText = (textContent as any).text as string;
          if (newText.length > fullText.length) {
            const delta = newText.slice(fullText.length);
            fullText = newText;
            onChunk(delta);
          }
        }
      }
    }

    // Fallback: if items-stream didn't capture text, get it directly
    if (!fullText) {
      fullText = await result.getText();
      if (fullText) onChunk(fullText);
    }

    recordTrace({
      traceId, model: modelId, inputTokensEstimate: inputTokens,
      outputTokensEstimate: estimateTokens(fullText),
      latencyMs: Date.now() - start, status: 'success',
      timestamp: new Date().toISOString(),
    });
    onDone();
  } catch (err: any) {
    recordTrace({
      traceId, model: modelId, inputTokensEstimate: inputTokens,
      outputTokensEstimate: 0, latencyMs: Date.now() - start,
      status: 'error', error: (err.message || '').slice(0, 200),
      timestamp: new Date().toISOString(),
    });
    throw err;
  }
}

// ──────────────────────────────────────────────
// Public API: callLLM with OpenRouter → MiniMax fallback
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
    return await callOpenRouter(
      messages,
      params.temperature || 0.7,
      params.maxTokens || 4096,
      traceId,
      params.skill,
    );
  } catch {
    // Fallback to MiniMax
    if (!MINIMAX_API_KEY) throw new Error('OpenRouter failed and no MiniMax fallback configured');
    console.log(`[LLM fallback] OpenRouter failed, trying MiniMax | ${traceId}`);
    return await fetchMiniMax(
      messages,
      params.temperature || 0.7,
      params.maxTokens || 4096,
      traceId + '_fallback',
      params.skill,
    );
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

  await streamOpenRouter(
    messages,
    params.temperature || 0.7,
    params.maxTokens || 4096,
    traceId,
    params.onChunk,
    params.onDone,
  );
}

// Multi-turn call for ReAct agent — accepts full message array
export async function callLLMMultiTurn(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  skill?: string;
}): Promise<string> {
  const traceId = generateTraceId();
  return await callOpenRouter(
    params.messages,
    params.temperature ?? 0.3,
    params.maxTokens ?? 2048,
    traceId,
    params.skill || 'multi_turn',
    params.model,
  );
}

// ============================================================
// ReAct agent call (via OpenRouter SDK)
// ============================================================

export async function callDeepSeek(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const traceId = generateTraceId();
  return await callOpenRouter(
    params.messages,
    params.temperature ?? 0.3,
    params.maxTokens ?? 2048,
    traceId,
    'react_agent',
    params.model,
  );
}

// ============================================================
// JSON Parser with repair heuristics
// ============================================================

export function parseJsonFromResponse(text: string): any {
  // Extract JSON from markdown code blocks or raw text
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);

  // If no closing }, JSON is probably truncated — grab everything from first {
  let jsonStr: string;
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const startIdx = text.indexOf('{');
    if (startIdx === -1) throw new Error('No JSON found in response');
    jsonStr = text.slice(startIdx).trim();
  }

  // ═══ Attempt 1: Direct parse ═══
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Continue to repairs
  }

  // ═══ Attempt 2: Truncation repair only ═══
  try {
    const truncated = repairTruncatedJson(jsonStr);
    return JSON.parse(truncated);
  } catch {
    // Continue to aggressive repairs
  }

  // ═══ Attempt 3: Markdown/formatting cleanup ═══
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

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(repairTruncatedJson(cleaned));
    } catch {}
  }

  // ═══ Attempt 4: Last resort — aggressive fixes ═══
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
        `=== RAW TEXT (first 2000) ===\n${text.slice(0, 2000)}\n\n=== AFTER REPAIR (first 2000) ===\n${cleaned.slice(0, 2000)}\n\n=== ERROR ===\n${e.message}\n`);
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
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) {
      inString = !inString;
      continue;
    }
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
