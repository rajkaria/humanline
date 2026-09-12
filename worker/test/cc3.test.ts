// queryId / txIndex arithmetic: the worker must reproduce exactly what ASCBase computes
// on-chain, otherwise `processedQueries` pre-checks are meaningless. No network.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { solidityPackedKeccak256 } from "ethers";
import { computeQueryId, computeTxIndex, revertReason } from "../src/cc3";
import { REPO_ROOT, SOURCES } from "../src/config";
import { readProofFile } from "../src/proofs";

const MAINNET = await readProofFile(
  resolve(REPO_ROOT, "contracts/test/fixtures/mainnet-0x81ece311.json"),
);
const SEPOLIA = await readProofFile(
  resolve(REPO_ROOT, "contracts/test/fixtures/sepolia-0x36678603.json"),
);

describe("computeTxIndex", () => {
  test("reproduces the prover's txIndex for both real fixtures", () => {
    expect(computeTxIndex(MAINNET.merkleProof.siblings)).toBe(MAINNET.txIndex);
    expect(computeTxIndex(SEPOLIA.merkleProof.siblings)).toBe(SEPOLIA.txIndex);
  });

  test("an empty path is index 0", () => {
    expect(computeTxIndex([])).toBe(0);
  });

  test("isLeft sets the bit for that level, lowest level first", () => {
    const s = (isLeft: boolean) => ({ hash: `0x${"00".repeat(32)}`, isLeft });
    expect(computeTxIndex([s(true)])).toBe(1);
    expect(computeTxIndex([s(false), s(true)])).toBe(2);
    expect(computeTxIndex([s(true), s(true), s(true)])).toBe(7);
    expect(computeTxIndex([s(false), s(false), s(false)])).toBe(0);
  });
});

describe("computeQueryId", () => {
  // ASCBase hashes 72 bytes: uint256(chainKey) ++ uint64(blockHeight) ++ uint256(txIndex).
  // solidityPackedKeccak256 is an independent path to the same packed buffer.
  const reference = (chainKey: number, height: number, txIndex: number) =>
    solidityPackedKeccak256(["uint256", "uint64", "uint256"], [chainKey, height, txIndex]);

  test("matches the packed-keccak reference for the mainnet fixture", () => {
    expect(computeQueryId(MAINNET.chainKey, MAINNET.headerNumber, MAINNET.txIndex)).toBe(
      reference(MAINNET.chainKey, MAINNET.headerNumber, MAINNET.txIndex),
    );
  });

  test("matches the packed-keccak reference for the sepolia fixture", () => {
    expect(computeQueryId(SEPOLIA.chainKey, SEPOLIA.headerNumber, SEPOLIA.txIndex)).toBe(
      reference(SEPOLIA.chainKey, SEPOLIA.headerNumber, SEPOLIA.txIndex),
    );
  });

  test("is stable (a regression lock on the replay key)", () => {
    expect(computeQueryId(3, 25959565, 173)).toBe(
      "0xbba7da5b6a243076d24b390ebf1731aabc8d55520b3291dd310d531371dafc45",
    );
    expect(computeQueryId(1, 11687163, 58)).toBe(
      "0x46cecbe3df79860bcbf1d7cd1ccfe447eeba6d46cefbb4e64abdd3cb6e8e46bc",
    );
  });

  test("the same block and index on different source chains give different ids", () => {
    expect(computeQueryId(SOURCES.mainnet.chainKey, 100, 5)).not.toBe(
      computeQueryId(SOURCES.sepolia.chainKey, 100, 5),
    );
  });

  test("accepts bigint inputs identically", () => {
    expect(computeQueryId(3n, 25959565n, 173n)).toBe(computeQueryId(3, 25959565, 173));
  });
});

describe("revertReason", () => {
  test("prefers a decoded custom error with its arguments", () => {
    expect(revertReason({ revert: { name: "NotFinal", args: [100, 200] } })).toBe(
      "NotFinal(100, 200)",
    );
    expect(revertReason({ revert: { name: "SourceTxReverted", args: [] } })).toBe(
      "SourceTxReverted()",
    );
  });

  test("decodes raw revert data against the AttestedWorldID ABI", () => {
    // NoTreeChange() selector.
    const selector = "0x2f5ab24f";
    const decoded = revertReason({ data: selector });
    expect(typeof decoded).toBe("string");
  });

  test("falls back through reason, nested RPC error, then message", () => {
    expect(revertReason({ reason: "Query already processed" })).toBe("Query already processed");
    expect(revertReason({ info: { error: { message: "nonce too low" } } })).toBe("nonce too low");
    expect(revertReason(new Error("boom"))).toBe("boom");
  });
});
