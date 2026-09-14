/**
 * G-01: простой in-memory rate limiter (fixed window) для auth/import.
 * Однопроцессный dev/prod-инстанс покрывается; при горизонтальном
 * масштабировании заменяется Redis-лимитером (та же сигнатура).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, limit: number, windowSec: number, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  bucket.count++;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfterSec: 0 };
}

/** Для тестов. */
export function resetRateLimits(): void {
  buckets.clear();
}
