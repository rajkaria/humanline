/**
 * Proof builder JSON → executeBatch arguments, against real proofs.
 *
 * The fixtures are proofs the CC3 proof builder served for real World ID
 * identity-manager transactions (the same files the Foundry tests replay), so a
 * shape change upstream fails here rather than in someone's wallet.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, encodeFunctionData } from "viem";

import { attestedWorldIdAbi } from "@/lib/abi";
import {
  argsFromJson,
  argsToJson,
  normalizeBatch,
  normalizeSingle,
  proofBytes,
  toExecuteBatchArgs,
  txIndexFromSiblings,
  type BatchProofJson,
  type SingleProofJson,
} from "@/lib/relay/proof";

const FIXTURES = join(import.meta.dir, "..", "..", "contracts", "test", "fixtures");
const sepolia = JSON.parse(readFileSync(join(FIXTURES, "sepolia-0x36678603.json"), "utf8")) as SingleProofJson;
const mainnet = JSON.parse(readFileSync(join(FIXTURES, "mainnet-0x81ece311.json"), "utf8")) as SingleProofJson;

/** The batch shape the builder answers with, built from real single proofs. */
function asBatch(...proofs: SingleProofJson[]): BatchProofJson {
  const merkleProofs: BatchProofJson["merkleProofs"] = {};
  for (const p of proofs) {
    merkleProofs[String(p.headerNumber)] ??= {};
    merkleProofs[String(p.headerNumber)]![String(p.txIndex)] = {
      txHash: p.txHash,
      txBytes: p.txBytes,
      merkleProof: p.merkleProof,
    };
  }
  const heights = proofs.map((p) => p.headerNumber);
  return {
    chainKey: proofs[0]!.chainKey,
    fromHeader: Math.min(...heights),
    toHeader: Math.max(...heights),
    continuityProof: proofs[0]!.continuityProof,
    merkleProofs,
  };
}

describe("txIndexFromSiblings", () => {
  test("matches the builder's own txIndex on both real fixtures", () => {
    expect(txIndexFromSiblings(normalizeSingle(sepolia).members[0]!.merkleProof.siblings)).toBe(58);
    expect(txIndexFromSiblings(normalizeSingle(mainnet).members[0]!.merkleProof.siblings)).toBe(173);
  });
});

describe("normalizeSingle", () => {
  test("a real Sepolia proof becomes a one-member batch", () => {
    const batch = normalizeSingle(sepolia, sepolia.txHash);
    expect(batch.chainKey).toBe(1);
    expect(batch.members).toHaveLength(1);
    expect(batch.members[0]!.blockHeight).toBe(11_687_163);
    expect(batch.continuityProof.roots.length).toBe(sepolia.continuityProof.roots.length);
  });

  test("refuses a proof for a different transaction", () => {
    expect(() => normalizeSingle(sepolia, mainnet.txHash)).toThrow(/missing/);
  });

  test("refuses a proof whose Merkle path disagrees with its txIndex", () => {
    expect(() => normalizeSingle({ ...sepolia, txIndex: 59 })).toThrow(/encodes index 58/);
  });

  test("refuses non-hex bytes", () => {
    expect(() => normalizeSingle({ ...sepolia, txBytes: "nope" })).toThrow(/not hex/);
  });
});

describe("normalizeBatch", () => {
  test("orders members by height regardless of JSON key order", () => {
    const later = { ...sepolia, txHash: `0x${"ab".repeat(32)}`, headerNumber: sepolia.headerNumber + 5 };
    const data = asBatch(later, sepolia);
    const batch = normalizeBatch(data, [later.txHash, sepolia.txHash]);
    expect(batch.members.map((m) => m.blockHeight)).toEqual([sepolia.headerNumber, sepolia.headerNumber + 5]);
  });

  test("a partial batch is rejected, never submitted as complete", () => {
    expect(() => normalizeBatch(asBatch(sepolia), [sepolia.txHash, `0x${"cd".repeat(32)}`])).toThrow(/missing 1/);
  });

  test("an extra member is rejected", () => {
    const other = { ...sepolia, txHash: `0x${"ef".repeat(32)}`, headerNumber: sepolia.headerNumber + 1 };
    expect(() => normalizeBatch(asBatch(sepolia, other), [sepolia.txHash])).toThrow(/unexpected/);
  });

  test("hash matching is case-insensitive", () => {
    expect(normalizeBatch(asBatch(sepolia), [sepolia.txHash.toUpperCase().replace("0X", "0x")]).members).toHaveLength(1);
  });
});

describe("executeBatch encoding", () => {
  test("the args encode against the real ABI and decode back identically", () => {
    const args = toExecuteBatchArgs(normalizeSingle(sepolia));
    const data = encodeFunctionData({ abi: attestedWorldIdAbi, functionName: "executeBatch", args });
    expect(data.slice(0, 10)).toBe("0x" + data.slice(2, 10));
    const decoded = decodeFunctionData({ abi: attestedWorldIdAbi, data });
    expect(decoded.functionName).toBe("executeBatch");
    expect(decoded.args?.[0]).toBe(1n);
    expect(decoded.args?.[1]).toEqual([11_687_163n]);
  });

  test("args survive the JSON trip the API route makes", () => {
    const args = toExecuteBatchArgs(normalizeSingle(mainnet));
    expect(argsFromJson(JSON.parse(JSON.stringify(argsToJson(args))))).toEqual(args);
  });

  test("proofBytes is a positive, plausible size", () => {
    const bytes = proofBytes(normalizeSingle(sepolia));
    expect(bytes).toBeGreaterThan((sepolia.txBytes.length - 2) / 2);
    expect(bytes).toBeLessThan(200_000);
  });
});
