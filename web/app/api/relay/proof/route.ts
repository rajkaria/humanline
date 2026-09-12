import { NextResponse } from "next/server";

import { argsToJson, proofBytes, toExecuteBatchArgs } from "@/lib/relay/proof";
import { fetchRelayProof, ProverError } from "@/lib/relay/prover";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Ready-to-send `AttestedWorldID.executeBatch` arguments for up to ten World ID
 * updates, built from the Attestcoin proof builder.
 *
 * `POST /api/relay/proof` with `{ "chainKey": 1, "txHashes": ["0x…", …] }`, hashes
 * in source order (as `/api/relay/plan` lists them).
 *
 * The response is only a convenience encoding of the builder's public proof: the
 * wallet sending it is the user's, and the 0x0FD2 precompile plus
 * `AttestedWorldID` decide whether it is true. A forged proof costs its sender a
 * revert and nothing else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function POST(request: Request) {
  // Building a batch proof is real work for the CC3 prover; keep one caller modest.
  const limited = rateLimit(`relay-proof:${clientKey(request)}`, { limit: 12, windowMs: 60_000 });
  if (!limited.ok) return tooManyRequests(limited);

  let body: { chainKey?: unknown; txHashes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const chainKey = Number(body.chainKey);
  if (chainKey !== 1 && chainKey !== 3) {
    return NextResponse.json({ error: "bad_chain_key" }, { status: 400 });
  }
  const hashes = body.txHashes;
  if (
    !Array.isArray(hashes) ||
    hashes.length === 0 ||
    hashes.length > 10 ||
    !hashes.every((h) => typeof h === "string" && HASH.test(h)) ||
    new Set(hashes.map((h: string) => h.toLowerCase())).size !== hashes.length
  ) {
    return NextResponse.json(
      { error: "bad_tx_hashes", message: "txHashes must be 1-10 distinct 32-byte hex hashes." },
      { status: 400 },
    );
  }

  try {
    const batch = await fetchRelayProof(chainKey, hashes as string[]);
    return NextResponse.json(
      {
        chainKey,
        args: argsToJson(toExecuteBatchArgs(batch)),
        members: batch.members.map((m) => ({
          txHash: m.txHash,
          blockHeight: m.blockHeight,
          txIndex: m.txIndex,
        })),
        proofBytes: proofBytes(batch),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof ProverError && error.status === 404 ? 409 : 502;
    return NextResponse.json(
      {
        error: status === 409 ? "not_attested" : "prover_error",
        message: error instanceof Error ? error.message.slice(0, 300) : "Could not build the proof.",
      },
      { status },
    );
  }
}
