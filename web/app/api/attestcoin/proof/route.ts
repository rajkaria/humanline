import { NextResponse } from "next/server";

import { PROOF_BUILDER_URL } from "@/lib/chains";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Proxy the CC3 proof builder.
 *
 * The builder exposes `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` (see
 * `@gluwa/usc-sdk` `proofProvider.service.ProofBuilder`). The browser cannot call
 * it directly — it sets no CORS headers — so `/judge` asks this route, which is
 * also where the request gets validated before it leaves our origin.
 *
 * Read-only and unauthenticated in both directions: no key is attached, nothing
 * is stored, and the response is the builder's own JSON.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_CHAIN_KEYS = new Set([1, 3]);

export async function GET(request: Request) {
  // Proof building is expensive for the CC3 prover, so cap what one caller can
  // ask for. Deliberately not origin-locked: a judge pasting this URL into a
  // terminal is a use we want to support.
  const limited = rateLimit(`proof:${clientKey(request)}`, { limit: 20, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);

  const url = new URL(request.url);
  const chainKeyRaw = url.searchParams.get("chainKey");
  const txHash = url.searchParams.get("txHash")?.trim() ?? "";

  const chainKey = Number(chainKeyRaw);
  if (!Number.isInteger(chainKey) || !ALLOWED_CHAIN_KEYS.has(chainKey)) {
    return NextResponse.json(
      { error: "bad_chain_key", message: "chainKey must be 3 (Ethereum mainnet) or 1 (Sepolia)." },
      { status: 400 },
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json(
      { error: "bad_tx_hash", message: "txHash must be a 32-byte hex string." },
      { status: 400 },
    );
  }

  const target = `${PROOF_BUILDER_URL}/api/v1/proof-by-tx/${chainKey}/${txHash}`;

  try {
    const response = await fetch(target, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        {
          error: "prover_error",
          status: response.status,
          message:
            response.status === 404
              ? "The proof builder has no proof for that transaction. It must be on the chosen source chain and old enough to be attested."
              : `The proof builder returned HTTP ${response.status}.`,
          body: text.slice(0, 500),
        },
        { status: 502 },
      );
    }

    return new NextResponse(text, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "prover_unreachable",
        message:
          error instanceof Error && error.name === "TimeoutError"
            ? "The proof builder did not answer within 25 seconds."
            : "Could not reach the proof builder.",
      },
      { status: 504 },
    );
  }
}
