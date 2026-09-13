/**
 * Attack inputs are replayed long after they are discovered, so discovery keeps only proofs whose
 * continuity chain ends at a checkpoint. The fold is checked against digests CC3's ChainInfo reported
 * for the real fixtures (the same values `verify-proof.test.ts` pins).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";

import { checkpointAnchored, foldDigest } from "@/lib/attacks/discover";
import type { SingleProofJson } from "@/lib/relay/proof";

const FIXTURES = join(import.meta.dir, "..", "..", "contracts", "test", "fixtures");
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as SingleProofJson;

const CHECKPOINTS: Record<string, [number, Hex]> = {
  "sepolia-0x36678603.json": [11_687_200, "0xf2262d48a4061abb9cb3fa45ac81f355f4d7c3313e3df948be90f6815df7fa02"],
  "sepolia-usdc-transfer-0x2e34a903.json": [11_692_100, "0x737f14ab88818e955ad23f8b50ed92fccf8c5a3975b05e5abda8393b1be0b93f"],
};

const chainInfo = (answer: { hash: Hex; exists: boolean }) => {
  const calls: unknown[][] = [];
  return {
    calls,
    client: {
      readContract: async (req: { args: unknown[] }) => {
        calls.push(req.args);
        return answer;
      },
    } as never,
  };
};

describe("foldDigest", () => {
  for (const [name, [upper, digest]] of Object.entries(CHECKPOINTS)) {
    test(`folds ${name} to the checkpoint CC3 recorded`, () => {
      expect(foldDigest(load(name))).toEqual({ upperHeight: upper, digest });
    });
  }
});

describe("checkpointAnchored", () => {
  const proof = load("sepolia-0x36678603.json");
  const [upper, digest] = CHECKPOINTS["sepolia-0x36678603.json"]!;

  test("accepts a proof whose fold matches the recorded checkpoint at its upper height", async () => {
    const { client, calls } = chainInfo({ hash: digest, exists: true });
    expect(await checkpointAnchored(client, proof)).toBe(true);
    expect(calls[0]).toEqual([1n, BigInt(upper)]);
  });

  test("refuses when there is no checkpoint there, or it records a different digest", async () => {
    expect(await checkpointAnchored(chainInfo({ hash: digest, exists: false }).client, proof)).toBe(false);
    expect(await checkpointAnchored(chainInfo({ hash: `0x${"00".repeat(32)}`, exists: true }).client, proof)).toBe(false);
  });
});
