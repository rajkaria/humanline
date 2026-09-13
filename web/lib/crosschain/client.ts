/**
 * Browser-side cross-chain calls: fetch a proof through `/api/attestcoin/proof` and dry-run the
 * Creditcoin call it feeds, so a named revert (`NotFinal`, `WalletNotLinked`, …) shows up before a
 * wallet is asked to sign.
 */

import type { Address, Hex } from "viem";

import type { SourceChainKey } from "@/lib/chains";
import { sourceProofFromJson, type SourceProofStruct } from "@/lib/crosschain/core";
import { describeError } from "@/lib/format";
import { getPublicClient } from "@/lib/public-client";
import type { SingleProofJson } from "@/lib/relay/proof";
import { verifySourceProofInBrowser } from "@/lib/relay/verify-proof";

export async function fetchSourceProof(chainKey: SourceChainKey, txHash: Hex): Promise<SourceProofStruct> {
  const response = await fetch(`/api/attestcoin/proof?chainKey=${chainKey}&txHash=${txHash}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as SingleProofJson & { message?: string };
  if (!response.ok) {
    throw new Error(
      body.message ??
        `The proof builder has no proof for ${txHash} yet (HTTP ${response.status}). A transaction becomes provable once it is attested, about 15 minutes after inclusion.`,
    );
  }
  const proof = sourceProofFromJson(body, txHash);
  // Re-verify inclusion and continuity in the browser, against the digest Creditcoin attested.
  const checked = await verifySourceProofInBrowser(getPublicClient(), proof, body.txIndex);
  if (!checked.ok) throw new Error(`Your browser refused this proof: ${checked.reason}.`);
  return proof;
}

/** `eth_call` the write first; resolves `null` when it would succeed, else the decoded reason. */
export async function dryRun(request: {
  account: Address;
  address: Address;
  // viem checks the concrete ABI/function/args at each call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any;
  functionName: string;
  args: readonly unknown[];
}): Promise<string | null> {
  try {
    await getPublicClient().simulateContract(request);
    return null;
  } catch (error) {
    return describeError(error);
  }
}
