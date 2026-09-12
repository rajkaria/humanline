import { NextResponse } from "next/server";

import { PROOF_BUILDER_URL } from "@/lib/chains";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Proxy the proof builder's attested-height endpoint.
 *
 * `GET /api/v1/attested-height/{chainKey}` reports how far the CC3 attestors
 * have followed a source chain. `/relay` uses it as a second opinion next to the
 * 0x0FD3 precompile, whose "latest attested height" getter name is still being
 * confirmed upstream.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_CHAIN_KEYS = new Set([1, 3]);

export async function GET(request: Request) {
  // Cheap upstream, but still someone else's quota. /relay polls this at most
  // twice per 30s per viewer, so 60/min leaves plenty of headroom.
  const limited = rateLimit(`height:${clientKey(request)}`, { limit: 60, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);

  const chainKey = Number(new URL(request.url).searchParams.get("chainKey"));
  if (!Number.isInteger(chainKey) || !ALLOWED_CHAIN_KEYS.has(chainKey)) {
    return NextResponse.json({ error: "bad_chain_key" }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${PROOF_BUILDER_URL}/api/v1/attested-height/${chainKey}`,
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      return NextResponse.json(
        { error: "prover_error", status: response.status },
        { status: 502 },
      );
    }
    const data = (await response.json()) as { attestedHeight?: number | string };
    return NextResponse.json(
      { chainKey, attestedHeight: data.attestedHeight ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "prover_unreachable" }, { status: 504 });
  }
}
