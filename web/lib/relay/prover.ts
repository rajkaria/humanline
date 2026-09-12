/**
 * Fetch an Attestcoin proof for the transactions one `executeBatch` will carry.
 *
 * Server-only (the builder sets no CORS headers). One transaction uses the single
 * endpoint; two or more use the shared-continuity batch endpoint, which is what
 * keeps a ten-root catch-up to one continuity proof instead of ten.
 */

import { PROOF_BUILDER_URL } from "@/lib/chains";
import {
  normalizeBatch,
  normalizeSingle,
  type BatchProofJson,
  type NormalizedBatch,
  type SingleProofJson,
} from "@/lib/relay/proof";

export class ProverError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProverError";
  }
}

async function readJson(response: Response, what: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new ProverError(
      response.status === 404
        ? `The proof builder has no ${what} yet: the transaction must be attested first.`
        : `The proof builder answered HTTP ${response.status} for the ${what}: ${text.slice(0, 200)}`,
      response.status,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProverError(`The proof builder returned malformed JSON for the ${what}.`, 502);
  }
}

export async function fetchRelayProof(
  chainKey: number,
  txHashes: readonly string[],
  { timeoutMs = 60_000, baseUrl = PROOF_BUILDER_URL }: { timeoutMs?: number; baseUrl?: string } = {},
): Promise<NormalizedBatch> {
  if (txHashes.length === 0) throw new ProverError("No transactions to prove.", 400);

  if (txHashes.length === 1) {
    const response = await fetch(`${baseUrl}/api/v1/proof-by-tx/${chainKey}/${txHashes[0]}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await readJson(response, "proof")) as SingleProofJson;
    return normalizeSingle(data, txHashes[0]);
  }

  const response = await fetch(`${baseUrl}/api/v1/proof-batch-by-tx/${chainKey}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(txHashes),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await readJson(response, "batch proof")) as BatchProofJson;
  return normalizeBatch(data, txHashes);
}
