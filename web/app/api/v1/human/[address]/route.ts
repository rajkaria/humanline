import { NextResponse } from "next/server";

import { CORS_HEADERS, errorBody, parseAddress, parseProfile, readHuman } from "@/lib/api/v1";
import { getPublicClient } from "@/lib/public-client";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * `GET /api/v1/human/{address}?profile=staging|production`
 *
 * Whether the wallet is bound to a verified World ID human on Creditcoin, the human's nullifier and
 * registration date, and their credit line. Read straight from the contracts; CORS open. See /api.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const limited = rateLimit(`v1-human:${clientKey(request)}`, { limit: 60, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);
  try {
    const { address } = await params;
    const profile = parseProfile(new URL(request.url).searchParams.get("profile"));
    const body = await readHuman(getPublicClient(), profile, parseAddress(address));
    return NextResponse.json(body, {
      headers: { ...CORS_HEADERS, "cache-control": "public, s-maxage=15, stale-while-revalidate=60" },
    });
  } catch (error) {
    const { status, body } = errorBody(error);
    return NextResponse.json(body, { status, headers: CORS_HEADERS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
