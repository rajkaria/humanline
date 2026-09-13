/**
 * In-browser proof verification against the five real proofs in `contracts/test/fixtures/`, and the
 * forgeries it must refuse without touching the network.
 *
 * The attested digests below were read from ChainInfo `0x0FD3` on CC3 testnet
 * (`get_checkpoint_for_height`, and identically `get_attestation_bounds(...).childHash`) on
 * 2026-09-13, so the pure fold is checked against what Creditcoin's attestors actually signed.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex, PublicClient } from "viem";

import { normalizeSingle, toExecuteBatchArgs, type SingleProofJson } from "@/lib/relay/proof";
import { sourceProofFromJson } from "@/lib/crosschain/core";
import {
  digestIsAttested,
  foldContinuity,
  merkleRootOf,
  verifyBatchInBrowser,
  verifyLocally,
  verifySourceProofInBrowser,
} from "@/lib/relay/verify-proof";

const FIXTURES = join(import.meta.dir, "..", "..", "contracts", "test", "fixtures");
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as SingleProofJson;

/** fixture → (upper height, digest Creditcoin's ChainInfo reports for it) */
const ATTESTED: Record<string, [number, Hex]> = {
  "sepolia-0x36678603.json": [11_687_200, "0xf2262d48a4061abb9cb3fa45ac81f355f4d7c3313e3df948be90f6815df7fa02"],
  "mainnet-0x81ece311.json": [25_959_600, "0xe8c88d21bc2d3bd6ea5ccc7b56469552e0ac53a5538cd8f64e5c56ad0cb4220a"],
  "sepolia-aave-borrow-0xe4723adf.json": [11_607_900, "0x2289e963ca10eae2d2ededa9d0a7468509b5b1391e9144ada1dee7958000e906"],
  "sepolia-aave-repay-0xf3770ee1.json": [11_690_900, "0x00425dc47c0953aee26af9382d1ae75cfb568ab90519959d751efcfcfc133957"],
  "sepolia-usdc-transfer-0x2e34a903.json": [11_692_100, "0x737f14ab88818e955ad23f8b50ed92fccf8c5a3975b05e5abda8393b1be0b93f"],
};

/** A PublicClient stand-in that answers ChainInfo like CC3 did for these fixtures. */
function fakeChainInfo(upper: number, digest: Hex, mode: "bounds" | "checkpoint" | "none"): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "get_attestation_bounds") {
        return mode === "bounds"
          ? { isAttested: true, childHeight: BigInt(upper), childHash: digest, childIsAttestation: false }
          : { isAttested: true, childHeight: BigInt(upper + 100), childHash: `0x${"00".repeat(32)}`, childIsAttestation: true };
      }
      return { exists: mode === "checkpoint", hash: mode === "checkpoint" ? digest : `0x${"00".repeat(32)}` };
    },
  } as unknown as PublicClient;
}

describe("the real proofs fold to the digests Creditcoin attested", () => {
  for (const [name, [upper, digest]] of Object.entries(ATTESTED)) {
    test(name, () => {
      const json = load(name);
      const batch = normalizeSingle(json);
      const local = verifyLocally(batch.members, batch.continuityProof);
      expect(local).toEqual({ ok: true, baseHeight: json.headerNumber, upperHeight: upper, digest });
    });
  }
});

describe("forgeries are refused before any network call", () => {
  const json = load("sepolia-usdc-transfer-0x2e34a903.json");

  test("a forged receipt (one byte of txBytes changed)", () => {
    const batch = normalizeSingle(json);
    const m = batch.members[0]!;
    const at = m.txBytes.length - 20;
    const forged = `${m.txBytes.slice(0, at)}${m.txBytes[at] === "f" ? "e" : "f"}${m.txBytes.slice(at + 1)}` as Hex;
    const result = verifyLocally([{ ...m, txBytes: forged }], batch.continuityProof);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/does not reach its transaction root/);
  });

  test("a Merkle path that claims another transaction index", () => {
    const batch = normalizeSingle(json);
    const result = verifyLocally([{ ...batch.members[0]!, txIndex: batch.members[0]!.txIndex + 1 }], batch.continuityProof);
    expect(result.ok ? "" : result.reason).toMatch(/different transaction index/);
  });

  test("a transaction root spliced out of the continuity chain", () => {
    const batch = normalizeSingle(json);
    const roots = [`0x${"12".repeat(32)}` as Hex, ...batch.continuityProof.roots.slice(1)];
    const result = verifyLocally(batch.members, { ...batch.continuityProof, roots });
    expect(result.ok ? "" : result.reason).toMatch(/not in the continuity chain/);
  });

  test("an empty proof", () => {
    expect(verifyLocally([], { lowerEndpointDigest: `0x${"00".repeat(32)}`, roots: [] }).ok).toBe(false);
  });
});

describe("attestation lookup", () => {
  const name = "sepolia-aave-repay-0xf3770ee1.json";
  const [upper, digest] = ATTESTED[name]!;
  const json = load(name);

  test("accepts through attestation bounds, then through a checkpoint", async () => {
    expect(await digestIsAttested(fakeChainInfo(upper, digest, "bounds"), 1, json.headerNumber, upper, digest)).toBe("checkpoint");
    expect(await digestIsAttested(fakeChainInfo(upper, digest, "checkpoint"), 1, json.headerNumber, upper, digest)).toBe("checkpoint");
    expect(await digestIsAttested(fakeChainInfo(upper, digest, "none"), 1, json.headerNumber, upper, digest)).toBeNull();
  });

  test("batch and SourceProof entry points agree", async () => {
    const client = fakeChainInfo(upper, digest, "checkpoint");
    const viaBatch = await verifyBatchInBrowser(client, toExecuteBatchArgs(normalizeSingle(json)));
    const viaSource = await verifySourceProofInBrowser(client, sourceProofFromJson(json), json.txIndex);
    expect(viaBatch).toEqual({ ok: true, upperHeight: upper, digest, via: "checkpoint" });
    expect(viaSource).toEqual(viaBatch);

    const dropped = sourceProofFromJson(json);
    dropped.continuityProof = { ...dropped.continuityProof, roots: dropped.continuityProof.roots.slice(0, -1) };
    const refused = await verifySourceProofInBrowser(client, dropped, json.txIndex);
    expect(refused.ok ? "" : refused.reason).toMatch(/never signed/);
  });

  test("merkle and continuity helpers are deterministic", () => {
    const batch = normalizeSingle(json);
    expect(merkleRootOf(batch.members[0]!.txBytes, batch.members[0]!.merkleProof.siblings)).toBe(batch.continuityProof.roots[0]!);
    expect(foldContinuity(json.headerNumber, batch.continuityProof)).toEqual({ upperHeight: upper, digest });
  });
});
