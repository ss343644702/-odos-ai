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
