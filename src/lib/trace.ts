/**
 * Lightweight tracing for LLM calls and agent execution.
 * Logs structured data for debugging, cost tracking, and performance monitoring.
 */

export interface TraceEntry {
  traceId: string;
  skill?: string;
  model: string;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  latencyMs: number;
  status: 'success' | 'error' | 'retry';
  error?: string;
  retryCount?: number;
  timestamp: string;
}

/** In-memory ring buffer for recent traces (last 200) */
const TRACE_BUFFER_SIZE = 200;
const traces: TraceEntry[] = [];

/** Rough token estimate: ~1.5 chars per token for Chinese, ~4 chars per token for English */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

export function generateTraceId(): string {
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recordTrace(entry: TraceEntry): void {
  traces.push(entry);
  if (traces.length > TRACE_BUFFER_SIZE) {
    traces.shift();
  }

  // Structured console log for server-side observability
  const icon = entry.status === 'success' ? '✓' : entry.status === 'retry' ? '↻' : '✗';
  console.log(
    `[LLM ${icon}] ${entry.model} | ${entry.skill || 'unknown'} | ${entry.latencyMs}ms | ~${entry.inputTokensEstimate}+${entry.outputTokensEstimate} tokens | ${entry.traceId}${entry.retryCount ? ` (retry #${entry.retryCount})` : ''}${entry.error ? ` | ${entry.error}` : ''}`
  );
}

/** Get recent traces (for debug API endpoint) */
export function getRecentTraces(limit = 50): TraceEntry[] {
  return traces.slice(-limit);
}

/** Get aggregate stats */
export function getTraceStats(): {
  totalCalls: number;
  errorRate: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
} {
  if (traces.length === 0) {
    return { totalCalls: 0, errorRate: 0, avgLatencyMs: 0, totalInputTokens: 0, totalOutputTokens: 0 };
  }

  const errors = traces.filter(t => t.status === 'error').length;
  const totalLatency = traces.reduce((sum, t) => sum + t.latencyMs, 0);
  const totalInput = traces.reduce((sum, t) => sum + t.inputTokensEstimate, 0);
  const totalOutput = traces.reduce((sum, t) => sum + t.outputTokensEstimate, 0);

  return {
    totalCalls: traces.length,
    errorRate: errors / traces.length,
    avgLatencyMs: Math.round(totalLatency / traces.length),
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
  };
}

// ──────────────────────────────────────────────
// Pipeline stage timings (branch-pipeline / 自由输入)
//
// LLM calls are traced above, but the free-input critical path also spends time in TTS,
// image generation, OSS upload, and the server-cache lookup — none of which go through
// callLLM. This records one entry per /api/branch-pipeline request with a breakdown of
// every stage, so the real latency distribution is visible at /api/debug/traces instead
// of being inferred from the code's serial structure.
// ──────────────────────────────────────────────

export interface PipelineStage {
  name: string;     // 'decision' | 'storyboard' | 'voice' | 'tts' | 'image' | ...
  ms: number;       // wall-clock duration of this stage
  status?: 'ok' | 'fallback' | 'skipped' | 'error';
  detail?: string;  // optional note (e.g. 'timeout', '3 segs')
}

export interface PipelineTrace {
  traceId: string;
  action: string;        // final decision action (reject / converge_to_main / ...)
  totalMs: number;       // end-to-end server time for the request
  stages: PipelineStage[];
  cached?: boolean;      // short-circuited before generation (reject / navigate_existing)
  timestamp: string;
}

const PIPELINE_BUFFER_SIZE = 100;
const pipelineTraces: PipelineTrace[] = [];

/** A tiny stopwatch helper: call .lap(name) to record the time since the previous lap. */
export function createStopwatch(getNow: () => number) {
  const t0 = getNow();
  let last = t0;
  const stages: PipelineStage[] = [];
  return {
    lap(name: string, status?: PipelineStage['status'], detail?: string) {
      const now = getNow();
      stages.push({ name, ms: now - last, status, detail });
      last = now;
    },
    stages,
    totalMs: () => getNow() - t0,
  };
}

export function recordPipelineTrace(entry: PipelineTrace): void {
  pipelineTraces.push(entry);
  if (pipelineTraces.length > PIPELINE_BUFFER_SIZE) {
    pipelineTraces.shift();
  }
  const breakdown = entry.stages.map((s) => `${s.name}=${s.ms}ms${s.status && s.status !== 'ok' ? `(${s.status})` : ''}`).join(' ');
  console.log(`[PIPELINE] ${entry.action} | total=${entry.totalMs}ms | ${breakdown} | ${entry.traceId}`);
}

export function getRecentPipelineTraces(limit = 30): PipelineTrace[] {
  return pipelineTraces.slice(-limit);
}

/** Aggregate average per-stage timing across recorded pipeline traces (generation runs only). */
export function getPipelineStageStats(): {
  totalRuns: number;
  avgTotalMs: number;
  avgByStage: Record<string, { avgMs: number; count: number }>;
} {
  const runs = pipelineTraces.filter((t) => !t.cached);
  if (runs.length === 0) return { totalRuns: 0, avgTotalMs: 0, avgByStage: {} };

  const acc: Record<string, { sum: number; count: number }> = {};
  for (const t of runs) {
    for (const s of t.stages) {
      const a = acc[s.name] || (acc[s.name] = { sum: 0, count: 0 });
      a.sum += s.ms;
      a.count += 1;
    }
  }
  const avgByStage: Record<string, { avgMs: number; count: number }> = {};
  for (const [name, a] of Object.entries(acc)) {
    avgByStage[name] = { avgMs: Math.round(a.sum / a.count), count: a.count };
  }
  const avgTotalMs = Math.round(runs.reduce((s, t) => s + t.totalMs, 0) / runs.length);
  return { totalRuns: runs.length, avgTotalMs, avgByStage };
}
