// LLM API Client - Using DeepSeek as primary LLM
// OpenAI-compatible API
// With: tracing, retry with exponential backoff, model fallback

import { generateTraceId, estimateTokens, recordTrace } from './trace';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

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

/** Determine if an error is transient (worth retrying) */
function isTransientError(status: number, errorText: string): boolean {
  // Rate limit, server errors, gateway timeouts
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  // Network-level errors
  if (errorText.includes('ECONNRESET') || errorText.includes('ETIMEDOUT')) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────
// Core fetch with retry
// ──────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  traceId: string,
  skill?: string,
): Promise<{ content: string; model: string }> {
  const model = body.model as string;
  const inputText = JSON.stringify(body.messages);
  const inputTokens = estimateTokens(inputText);

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
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          recordTrace({
            traceId,
            skill,
            model,
            inputTokensEstimate: inputTokens,
            outputTokensEstimate: 0,
            latencyMs: Date.now() - start,
            status: 'retry',
            error: `${response.status}: ${errorText.slice(0, 200)}`,
            retryCount: attempt + 1,
            timestamp: new Date().toISOString(),
          });
          await sleep(backoff);
          continue;
        }

        recordTrace({
          traceId,
          skill,
          model,
          inputTokensEstimate: inputTokens,
          outputTokensEstimate: 0,
          latencyMs: Date.now() - start,
          status: 'error',
          error: `${response.status}: ${errorText.slice(0, 200)}`,
          retryCount: attempt,
          timestamp: new Date().toISOString(),
        });
        throw new Error(`${model} API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content || '';
      const outputTokens = estimateTokens(content);

      recordTrace({
        traceId,
        skill,
        model,
        inputTokensEstimate: inputTokens,
        outputTokensEstimate: outputTokens,
        latencyMs: Date.now() - start,
        status: 'success',
        retryCount: attempt,
        timestamp: new Date().toISOString(),
      });

      return { content, model };
    } catch (error: any) {
      // Network errors (not HTTP errors)
      if (error.message?.includes('API error')) throw error; // Already logged above

      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        recordTrace({
          traceId,
          skill,
          model,
          inputTokensEstimate: inputTokens,
          outputTokensEstimate: 0,
          latencyMs: Date.now() - start,
          status: 'retry',
          error: error.message?.slice(0, 200),
          retryCount: attempt + 1,
          timestamp: new Date().toISOString(),
        });
        await sleep(backoff);
        continue;
      }

      recordTrace({
        traceId,
        skill,
        model,
        inputTokensEstimate: inputTokens,
        outputTokensEstimate: 0,
        latencyMs: Date.now() - start,
        status: 'error',
        error: error.message?.slice(0, 200),
        retryCount: attempt,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  throw new Error(`${model}: max retries exceeded`);
}

// ──────────────────────────────────────────────
// Public API: callLLM with DeepSeek → MiniMax fallback
// ──────────────────────────────────────────────

/** Skills that produce JSON (not free text) — enable JSON mode for these */
const JSON_SKILLS = new Set([
  'outlineGenerator', 'branchGenerator', 'entityExtractor',
  'storyboardGenerator', 'voiceGenerator', 'expandNode',
]);

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
  const wantJson = params.skill ? JSON_SKILLS.has(params.skill) : false;

  // Try DeepSeek first
  try {
    const { content } = await fetchWithRetry(
      DEEPSEEK_API_URL,
      DEEPSEEK_API_KEY,
      {
        model: 'deepseek-chat',
        messages,
        temperature: params.temperature || 0.7,
        max_tokens: params.maxTokens || 4096,
        ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
      },
      traceId,
      params.skill,
    );
    return content;
  } catch {
    // Fallback to MiniMax
    if (!MINIMAX_API_KEY) throw new Error('DeepSeek failed and no MiniMax fallback configured');

    console.log(`[LLM fallback] DeepSeek failed, trying MiniMax | ${traceId}`);
    const { content } = await fetchWithRetry(
      MINIMAX_API_URL,
      MINIMAX_API_KEY,
      {
        model: 'MiniMax-Text-01',
        messages,
        temperature: params.temperature || 0.7,
        max_tokens: params.maxTokens || 4096,
        ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
      },
      traceId + '_fallback',
      params.skill,
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: params.temperature || 0.7,
      max_tokens: params.maxTokens || 4096,
      stream: true,
      ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!response.ok || !response.body) {
    recordTrace({
      traceId,
      model: 'deepseek-chat',
      inputTokensEstimate: estimateTokens(JSON.stringify(messages)),
      outputTokensEstimate: 0,
      latencyMs: Date.now() - start,
      status: 'error',
      error: `Stream error: ${response.status}`,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`DeepSeek API stream error: ${response.status}`);
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
            traceId,
            model: 'deepseek-chat',
            inputTokensEstimate: estimateTokens(JSON.stringify(messages)),
            outputTokensEstimate: estimateTokens(fullOutput),
            latencyMs: Date.now() - start,
            status: 'success',
            timestamp: new Date().toISOString(),
          });
          params.onDone();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullOutput += content;
            params.onChunk(content);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  recordTrace({
    traceId,
    model: 'deepseek-chat',
    inputTokensEstimate: estimateTokens(JSON.stringify(messages)),
    outputTokensEstimate: estimateTokens(fullOutput),
    latencyMs: Date.now() - start,
    status: 'success',
    timestamp: new Date().toISOString(),
  });
  params.onDone();
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
  const { content } = await fetchWithRetry(
    DEEPSEEK_API_URL,
    DEEPSEEK_API_KEY,
    {
      model: params.model || 'deepseek-chat',
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 2048,
    },
    traceId,
    params.skill || 'multi_turn',
  );
  return content;
}

// ============================================================
// DeepSeek API Client — for ReAct agent
// ============================================================

export async function callDeepSeek(params: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const traceId = generateTraceId();
  const { content } = await fetchWithRetry(
    DEEPSEEK_API_URL,
    DEEPSEEK_API_KEY,
    {
      model: params.model || 'deepseek-chat',
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 2048,
    },
    traceId,
    'react_agent',
  );
  return content;
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

  // ═══ Attempt 2: Truncation repair only (most common case with JSON mode) ═══
  // When using response_format: json_object, the JSON is syntactically valid
  // but may be truncated due to max_tokens. Only close brackets.
  try {
    const truncated = repairTruncatedJson(jsonStr);
    return JSON.parse(truncated);
  } catch {
    // Continue to aggressive repairs
  }

  // ═══ Attempt 3: Markdown/formatting cleanup (for non-JSON-mode responses) ═══
  let cleaned = jsonStr;

  // Strip Markdown bold/italic markers
  cleaned = cleaned.replace(/:\s*\*\*([^*\n]*)\*\*/g, ': "$1"');
  cleaned = cleaned.replace(/\*\*/g, '');

  // Remove comments
  cleaned = cleaned.replace(/\/\/[^\n]*/g, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove control characters
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  // Remove trailing commas before ] or }
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  // Fix missing commas between objects/arrays
  cleaned = cleaned.replace(/\}(\s*)\{/g, '},$1{');
  cleaned = cleaned.replace(/\](\s*)\[/g, '],$1[');

  // Fix missing commas after } or ] before next key
  cleaned = cleaned.replace(/(\}|\])(\s*\n\s*)"(?=[a-zA-Z_])/g, '$1,$2"');

  // Fix missing commas between string values
  cleaned = cleaned.replace(/"(\s*\n\s*)"(?=[a-zA-Z_])/g, '",$1"');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try with truncation repair on cleaned version
    try {
      return JSON.parse(repairTruncatedJson(cleaned));
    } catch {}
  }

  // ═══ Attempt 4: Last resort — aggressive fixes for badly formatted output ═══
  // Quote unquoted keys: { theme: "value" } → { "theme": "value" }
  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_][\w]*)\s*:/g, '$1"$2":');

  // Wrap unquoted string values (only if clearly not a valid JSON value)
  cleaned = cleaned.replace(
    /("[\w\u4e00-\u9fff]+")\s*:\s*(?!["'{\[\d\-tfn])([^\n,\]}"[\]]+)/g,
    (_, key, val) => `${key}: "${val.trim()}"`,
  );

  try {
    return JSON.parse(repairTruncatedJson(cleaned));
  } catch (e: any) {
    // Debug: write to /tmp for inspection
    try {
      const fs = require('fs');
      fs.writeFileSync('/tmp/llm-json-fail.txt',
        `=== RAW TEXT (first 2000) ===\n${text.slice(0, 2000)}\n\n=== AFTER REPAIR (first 2000) ===\n${cleaned.slice(0, 2000)}\n\n=== ERROR ===\n${e.message}\n`);
    } catch {}
    throw new Error(`JSON parse failed after repair: ${e.message}`);
  }
}

/**
 * Repair truncated JSON by closing unclosed brackets/braces.
 * Handles: trailing commas, unclosed strings, missing ] and }.
 */
function repairTruncatedJson(json: string): string {
  let s = json;

  // Remove trailing incomplete string value (unclosed quote)
  // Find if we have an odd number of unescaped quotes
  let inString = false;
  let lastStringStart = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) {
      inString = !inString;
      if (inString) lastStringStart = i;
    }
  }
  if (inString && lastStringStart >= 0) {
    // We're inside an unclosed string — truncate to last complete value
    // Try to find the last complete property by going back to last good closing quote
    const beforeString = s.slice(0, lastStringStart);
    // Check if this is a value (after :) or a key
    const beforeTrimmed = beforeString.trimEnd();
    if (beforeTrimmed.endsWith(':')) {
      // It's a value — close the string and remove the key-value pair
      // Go back further to remove the key too
      const lastComma = beforeTrimmed.lastIndexOf(',');
      const lastBracket = Math.max(beforeTrimmed.lastIndexOf('{'), beforeTrimmed.lastIndexOf('['));
      s = s.slice(0, Math.max(lastComma, lastBracket) + 1);
    } else if (beforeTrimmed.endsWith(',') || beforeTrimmed.endsWith('[') || beforeTrimmed.endsWith('{')) {
      // It's a key in a new property — remove back to the comma/bracket
      s = beforeTrimmed;
    } else {
      // Close the string
      s += '"';
    }
  }

  // Remove trailing comma
  s = s.replace(/,\s*$/, '');

  // Close unclosed brackets and braces
  const open = { '{': 0, '[': 0 };
  inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (s[i] === '{') open['{']++;
    else if (s[i] === '}') open['{']--;
    else if (s[i] === '[') open['[']++;
    else if (s[i] === ']') open['[']--;
  }

  // Close in reverse order of what was opened (track actual open order)
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

  // Close remaining open brackets in reverse order
  while (stack.length > 0) {
    const opener = stack.pop();
    s += opener === '{' ? '}' : ']';
  }

  return s;
}
