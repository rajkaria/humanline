import { NextResponse } from "next/server";

import { relayReport } from "@/lib/relay/report";

/**
 * Watchdog endpoint for uptime monitors: `200` while every relayable World ID root
 * reaches Creditcoin within the 10-minute target, `503` when one is late or the
 * scheduled relay has stalled. The body says which, and for how long.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const report = await relayReport();
    const body = {
      status: report.health.status,
      reason: report.health.reason,
      waitingSec: report.health.waitingSec,
      lastRelayAgeSec: report.health.lastRelayAgeSec,
      pending: report.chains.reduce((n, c) => n + c.pending, 0),
      uptime24h: report.uptime24h.ratio,
      sloSec: report.sloSec,
      generatedAt: report.generatedAt,
    };
    return NextResponse.json(body, {
      status: report.health.status === "ok" ? 200 : 503,
      headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { status: "unknown", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
