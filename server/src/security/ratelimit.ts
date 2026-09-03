/**
 * Sliding-window rate limiting, keyed by principal identity.
 *
 * In-process by design: a single Render/Vercel instance is the expected shape
 * for this workload. `createRateLimiter` is storage-agnostic enough that the
 * bucket map can be swapped for Redis later without touching callers.
 */

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Seconds until the caller may retry. 0 when allowed. */
  retryAfterSeconds: number;
  resetAtMs: number;
}

interface Bucket {
  /** Timestamps of requests inside the current window. */
  hits: number[];
  /** Set when the caller is being penalised for sustained abuse. */
  blockedUntilMs?: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  /** Consecutive-window violations before a longer cooldown applies. */
  penaltyThreshold?: number;
  penaltyMs?: number;
  name: string;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly violations = new Map<string, number>();
  private readonly options: Required<RateLimiterOptions>;

  constructor(options: RateLimiterOptions) {
    this.options = {
      penaltyThreshold: 3,
      penaltyMs: 5 * 60_000,
      ...options,
    };
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    const { windowMs, maxRequests, penaltyThreshold, penaltyMs } = this.options;
    const bucket = this.buckets.get(key) ?? { hits: [] };

    if (bucket.blockedUntilMs && bucket.blockedUntilMs > now) {
      return {
        allowed: false,
        remaining: 0,
        limit: maxRequests,
        retryAfterSeconds: Math.ceil((bucket.blockedUntilMs - now) / 1000),
        resetAtMs: bucket.blockedUntilMs,
      };
    }

    const windowStart = now - windowMs;
    bucket.hits = bucket.hits.filter((timestamp) => timestamp > windowStart);

    if (bucket.hits.length >= maxRequests) {
      const violations = (this.violations.get(key) ?? 0) + 1;
      this.violations.set(key, violations);

      if (violations >= penaltyThreshold) {
        bucket.blockedUntilMs = now + penaltyMs;
        this.violations.set(key, 0);
      }

      this.buckets.set(key, bucket);
      const oldest = bucket.hits[0] ?? now;
      const resetAtMs = bucket.blockedUntilMs ?? oldest + windowMs;

      return {
        allowed: false,
        remaining: 0,
        limit: maxRequests,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
        resetAtMs,
      };
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);

    return {
      allowed: true,
      remaining: maxRequests - bucket.hits.length,
      limit: maxRequests,
      retryAfterSeconds: 0,
      resetAtMs: now + windowMs,
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
    this.violations.delete(key);
  }

  /** Drop idle buckets so long-lived processes do not grow unbounded. */
  sweep(now = Date.now()): number {
    const cutoff = now - this.options.windowMs * 4;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      const blocked = bucket.blockedUntilMs && bucket.blockedUntilMs > now;
      const lastHit = bucket.hits.length > 0 ? bucket.hits[bucket.hits.length - 1]! : 0;
      if (!blocked && lastHit < cutoff) {
        this.buckets.delete(key);
        this.violations.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get label(): string {
    return this.options.name;
  }
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  return new RateLimiter(options);
}

/** Start a periodic sweep for a set of limiters. Returns a stop function. */
export function startRateLimitSweeper(limiters: RateLimiter[], intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    for (const limiter of limiters) limiter.sweep();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
