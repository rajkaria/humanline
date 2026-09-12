/**
 * A small in-memory token bucket for the three API routes.
 *
 * None of them needs auth — two proxy a public proof builder and one mints a
 * short-lived `rp_context` — but all three are free for anyone to call, which
 * makes them a quota sink for the CC3 prover and a signing oracle for our RP
 * key. A per-IP bucket puts a ceiling on both.
 *
 * Deliberately in-process and deliberately small: this is one Vercel function,
 * not a distributed rate limiter, and a serverless cold start resetting a bucket
 * is an acceptable outcome for a demo. It is a speed bump against abuse, not a
 * security boundary — the security boundary is that the signing key never leaves
 * the server and the proxied URLs are built from constants.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

/** Evict idle buckets so the map cannot grow without bound. */
const MAX_BUCKETS = 5_000;

function sweep(now: number, windowMs: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > windowMs * 4) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest half rather than leak.
  if (buckets.size >= MAX_BUCKETS) {
    const entries = [...buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of entries.slice(0, Math.floor(entries.length / 2))) buckets.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Whole seconds the caller should wait before retrying. */
  retryAfter: number;
  remaining: number;
};

/**
 * Consume one token.
 *
 * `limit` tokens refill linearly over `windowMs`, so a caller gets a burst of
 * `limit` and then a steady trickle.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);

  const bucket = buckets.get(key);
  const refillPerMs = limit / windowMs;

  const tokens = bucket
    ? Math.min(limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs)
    : limit;

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
      remaining: 0,
    };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { ok: true, retryAfter: 0, remaining: Math.floor(tokens - 1) };
}

/**
 * Best-effort client identity.
 *
 * Behind Vercel, `x-forwarded-for` is set by the platform and its first entry is
 * the real client. A spoofed header only lets a caller split its own bucket, so
 * the worst case is the limiter being less effective, never someone else being
 * limited on their behalf.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** A 429 with the headers a well-behaved client will honour. */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: `Too many requests. Try again in ${result.retryAfter}s.`,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(result.retryAfter),
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * Reject cross-origin callers.
 *
 * Only `rp-context` uses this: it is the one route that produces a signature,
 * and nothing but our own pages has a reason to ask for one. A request with no
 * `Origin` and no `Referer` is allowed through — that is a same-origin
 * navigation or a curl from the operator, neither of which is the abuse case.
 */
export function isSameOrigin(request: Request): boolean {
  const self = new URL(request.url).host;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === self;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === self;
    } catch {
      return false;
    }
  }
  return true;
}
