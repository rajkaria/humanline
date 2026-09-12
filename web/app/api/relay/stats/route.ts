import { NextResponse } from "next/server";

import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { relayReport } from "@/lib/relay/report";

/**
 * The relay's measured track record: end-to-end latency (source block → Creditcoin),
 * relay delay (first relayable moment → relayed), uptime against a 10-minute target
 * over 24 h and 7 d, pending roots, who relayed, and the watchdog verdict.
 *
 * Every number is recomputed from public chain data (RootRelayed on CC3, block
 * timestamps on both chains, TreeChanged on the source chain). CORS open.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const limited = rateLimit(`relay-stats:${clientKey(request)}`, { limit: 30, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);
  try {
    const report = await relayReport();
    return NextResponse.json(report, {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "stats_failed", message: error instanceof Error ? error.message.slice(0, 300) : "unknown" },
      { status: 502, headers: { "access-control-allow-origin": "*" } },
    );
  }
}
