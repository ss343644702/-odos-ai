/**
 * In-memory sliding window rate limiter.
 * For production, replace with Redis-based solution.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

/** Clean up stale entries every 5 minutes */
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Check rate limit for a given key (e.g., IP or user ID).
 * Returns whether the request is allowed and remaining quota.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  cleanup(config.windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  const cutoff = now - config.windowMs;
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= config.maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      resetMs: oldestInWindow + config.windowMs - now,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.maxRequests - entry.timestamps.length,
    resetMs: config.windowMs,
  };
}

// ──────────────────────────────────────────────
// Preset rate limit configs
// ──────────────────────────────────────────────

/** Story generation: 10 requests per minute per IP */
export const GENERATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 1000,
};

/** Branch generation (player input): 20 requests per minute per IP */
export const BRANCH_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 60 * 1000,
};

/** Chat: 30 requests per minute per IP */
export const CHAT_LIMIT: RateLimitConfig = {
  maxRequests: 30,
  windowMs: 60 * 1000,
};

// ──────────────────────────────────────────────
// Helper to extract rate limit key from request
// ──────────────────────────────────────────────

export function getRateLimitKey(request: Request): string {
  // Try X-Forwarded-For first (behind proxy/CDN), then fallback to a default
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  // Fallback: use a hash-like approach from other identifiers
  return 'unknown-ip';
}
