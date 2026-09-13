import { NextResponse } from "next/server";

import { CORS_HEADERS, errorBody, parseNullifier, parseProfile, readLineResponse } from "@/lib/api/v1";
import { getPublicClient } from "@/lib/public-client";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * `GET /api/v1/line/{nullifier}?profile=staging|production`
 *
 * A human's credit line by World ID nullifier (decimal or 0x hex), and the wallet they hold today.
 * The line belongs to the person, so it survives wallet moves. CORS open. See /api.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ nullifier: string }> }) {
  const limited = rateLimit(`v1-line:${clientKey(request)}`, { limit: 60, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);
  try {
    const { nullifier } = await params;
    const profile = parseProfile(new URL(request.url).searchParams.get("profile"));
    const body = await readLineResponse(getPublicClient(), profile, parseNullifier(nullifier));
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
