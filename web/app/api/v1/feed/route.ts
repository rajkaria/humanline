import { NextResponse } from "next/server";

import { API_VERSION, CORS_HEADERS, errorBody, parseNullifier, parseProfile } from "@/lib/api/v1";
import { readFeed } from "@/lib/feed";
import { PROFILES } from "@/lib/profiles";
import { getPublicClient } from "@/lib/public-client";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * `GET /api/v1/feed?profile=staging|production&human={nullifier}&limit=200`
 *
 * The loan lifecycle as a JSON feed, newest first: `line.opened`, `loan.drawn`, `loan.repaid`,
 * `limit.changed`, `loan.defaulted`, each keyed by the human. Rebuilt from `CreditLine` events on
 * every request (cached 60 s at the edge). CORS open.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const limited = rateLimit(`v1-feed:${clientKey(request)}`, { limit: 20, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);
  try {
    const params = new URL(request.url).searchParams;
    const profile = parseProfile(params.get("profile"));
    const humanParam = params.get("human");
    const human = humanParam ? parseNullifier(humanParam) : undefined;
    const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 200) || 200));

    const { deployment } = PROFILES[profile];
    const creditLine = deployment.contracts.creditLine.address;
    if (!creditLine) return NextResponse.json({ error: "not_deployed", message: "no credit line" }, { status: 503, headers: CORS_HEADERS });

    const client = getPublicClient();
    let from = deployment.deploymentBlockOf("creditLine");
    const hash = deployment.deploymentTxHashOf("creditLine");
    if (from === 0n && hash) from = (await client.getTransactionReceipt({ hash }).catch(() => null))?.blockNumber ?? 0n;

    const feed = await readFeed(client, creditLine, from, { limit, human });
    return NextResponse.json(
      {
        version: API_VERSION,
        profile: profile === "demo" ? "staging" : "production",
        creditLine,
        decimals: 6,
        ...feed,
      },
      { headers: { ...CORS_HEADERS, "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (error) {
    const { status, body } = errorBody(error);
    return NextResponse.json(body, { status, headers: CORS_HEADERS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
