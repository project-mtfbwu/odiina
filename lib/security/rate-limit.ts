import "server-only";

import { createHash } from "node:crypto";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export interface RateLimiter {
  take(key: string, limit: number, windowSeconds: number): RateLimitDecision;
}

type Bucket = { count: number; resetAt: number };

class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  take(key: string, limit: number, windowSeconds: number): RateLimitDecision {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + windowSeconds * 1000,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        ),
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export const localRateLimiter: RateLimiter = new MemoryRateLimiter();

export function privacySafeRateLimitKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
