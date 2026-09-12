import { signRequest } from "@worldcoin/idkit-core/signing";
import { NextResponse } from "next/server";

import { WORLD_ACTION, WORLD_RP_ID } from "@/lib/contracts";
import { clientKey, isSameOrigin, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Sign a World ID proof request as the relying party.
 *
 * IDKit 4.x requires every proof request to carry an `rp_context` — a nonce and
 * timestamp pair signed by the relying party's key. That key is a secret, so the
 * signing has to happen here and never in the bundle: the browser receives only
 * the signature and the values it covers.
 *
 * The key is read from `WORLD_RP_SIGNER_PRIVATE_KEY` (repo root `.secrets.env`,
 * git-ignored). It is never logged, never returned, and never inlined into the
 * client bundle — note that the variable deliberately has no `NEXT_PUBLIC_`
 * prefix, which is what keeps Next from doing so.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { action?: unknown };

export async function POST(request: Request) {
  // This route produces a signature, so it is the one worth guarding hardest:
  // same-origin only, and a tight bucket. Neither is a security boundary — the
  // key never leaves the server and the action is pinned below — but together
  // they stop it being used as an open signing oracle.
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "cross_origin", message: "This endpoint only serves Humanline's own pages." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const limited = rateLimit(`rp-context:${clientKey(request)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) return tooManyRequests(limited);

  const signingKeyHex = process.env.WORLD_RP_SIGNER_PRIVATE_KEY;

  if (!signingKeyHex) {
    return NextResponse.json(
      {
        error: "rp_signer_not_configured",
        message:
          "WORLD_RP_SIGNER_PRIVATE_KEY is not set. Copy it from the repo-root .secrets.env into web/.env.local (see web/README.md).",
      },
      { status: 503 },
    );
  }

  if (!WORLD_RP_ID) {
    return NextResponse.json(
      {
        error: "rp_id_not_configured",
        message: "NEXT_PUBLIC_WORLD_RP_ID is not set.",
      },
      { status: 503 },
    );
  }

  // The action is part of the signed message, so a client cannot swap it after
  // the fact. We still pin it to the configured action rather than trusting the
  // request body: this endpoint exists to authorise one verification, not any.
  let requestedAction = WORLD_ACTION;
  try {
    const body = (await request.json()) as Body;
    if (typeof body?.action === "string" && body.action === WORLD_ACTION) {
      requestedAction = body.action;
    }
  } catch {
    // An empty body is fine — the configured action is the default.
  }

  try {
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex,
      action: requestedAction,
      ttl: 300,
    });

    return NextResponse.json(
      {
        rp_id: WORLD_RP_ID,
        nonce,
        created_at: createdAt,
        expires_at: expiresAt,
        signature: sig,
        action: requestedAction,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Deliberately does not echo the error: a malformed key would otherwise be
    // partially reflected back to the browser.
    console.error("[humanline] rp-context signing failed", error);
    return NextResponse.json(
      {
        error: "rp_signing_failed",
        message: "Could not sign the World ID proof request. Check the RP signing key.",
      },
      { status: 500 },
    );
  }
}
