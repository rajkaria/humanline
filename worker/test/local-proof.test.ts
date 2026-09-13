// Local proof building, verification arithmetic and byte-for-byte diffing. No network: the fixtures
// are real hosted-prover outputs, and usc-sdk's own KeccakMerkleTree is the cross-check for the
// Merkle arithmetic.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hexlify, randomBytes } from "ethers";
import { proofProvider } from "@gluwa/usc-sdk";
import { REPO_ROOT } from "../src/config";
import {
  CachingBlockProvider,
  diffProofs,
  foldContinuity,
  merkleRootOf,
  toPlainProof,
  verifyInclusion,
} from "../src/local-proof";
import { readProofFile, type SingleProof } from "../src/proofs";

const FIXTURES = [
  "mainnet-0x81ece311",
  "sepolia-0x36678603",
  "sepolia-aave-borrow-0xe4723adf",
  "sepolia-aave-repay-0xf3770ee1",
  "sepolia-usdc-transfer-0x2e34a903",
];
const load = (name: string) => readProofFile(resolve(REPO_ROOT, "contracts/test/fixtures", `${name}.json`));
const clone = (p: SingleProof): SingleProof => JSON.parse(JSON.stringify(p));

describe("verification arithmetic on real proofs", () => {
  for (const name of FIXTURES) {
    test(`${name}: inclusion verifies and continuity folds to its upper endpoint`, async () => {
      const proof = await load(name);
      expect(verifyInclusion(proof)).toEqual({ ok: true });
      const folded = foldContinuity(proof);
      expect(folded.upperHeight).toBe(proof.headerNumber + proof.continuityProof.roots.length - 1);
      expect(folded.digest).toMatch(/^0x[0-9a-f]{64}$/);
    });
  }

  test("one flipped byte of the receipt breaks inclusion", async () => {
    const proof = clone(await load("sepolia-usdc-transfer-0x2e34a903"));
    const at = proof.txBytes.length - 10;
    proof.txBytes = proof.txBytes.slice(0, at) + (proof.txBytes[at] === "0" ? "1" : "0") + proof.txBytes.slice(at + 1);
    expect(verifyInclusion(proof)).toEqual({ ok: false, reason: "Merkle path does not reach the block's transaction root" });
  });

  test("a flipped sibling side changes the index, and a dropped root changes the digest", async () => {
    const proof = clone(await load("sepolia-aave-repay-0xf3770ee1"));
    const honest = foldContinuity(proof);
    proof.merkleProof.siblings[0]!.isLeft = !proof.merkleProof.siblings[0]!.isLeft;
    expect(verifyInclusion(proof).ok).toBe(false);
    proof.continuityProof.roots.pop();
    expect(foldContinuity(proof).digest).not.toBe(honest.digest);
  });

  test("merkleRootOf agrees with usc-sdk's KeccakMerkleTree for every leaf", () => {
    const leaves = Array.from({ length: 13 }, () => hexlify(randomBytes(40 + Math.floor(Math.random() * 40))));
    const tree = new proofProvider.merkle.KeccakMerkleTree(leaves);
    leaves.forEach((leaf, i) => {
      const p = tree.getProof(i);
      expect(merkleRootOf(leaf, p.siblings)).toBe(tree.getRoot());
    });
  });
});

describe("diffProofs", () => {
  test("a proof is identical to itself", async () => {
    const proof = await load("mainnet-0x81ece311");
    expect(diffProofs(proof, clone(proof))).toEqual({
      identical: true,
      inclusionIdentical: true,
      continuityIdentical: true,
      differences: [],
    });
  });

  test("names inclusion differences precisely", async () => {
    const a = await load("sepolia-0x36678603");
    const b = clone(a);
    b.txBytes = `${b.txBytes.slice(0, 200)}ff${b.txBytes.slice(202)}`;
    b.merkleProof.siblings[2]!.isLeft = !b.merkleProof.siblings[2]!.isLeft;
    const d = diffProofs(a, b);
    expect(d.inclusionIdentical).toBe(false);
    expect(d.differences.some((x) => x.startsWith("txBytes differ from byte 99"))).toBe(true);
    expect(d.differences).toContain("sibling 2");
  });

  test("separates continuity (bounds-dependent) from inclusion", async () => {
    const a = await load("sepolia-aave-borrow-0xe4723adf");
    const b = clone(a);
    b.continuityProof.roots.push(`0x${"ab".repeat(32)}`);
    const d = diffProofs(a, b);
    expect(d.inclusionIdentical).toBe(true);
    expect(d.continuityIdentical).toBe(false);
    expect(d.identical).toBe(false);
  });

  test("toPlainProof strips SDK classes to the hosted builder's shape", async () => {
    const p = await load("sepolia-usdc-transfer-0x2e34a903");
    const sdkShaped = {
      ...p,
      merkleProof: new proofProvider.merkle.TransactionMerkleProof(
        p.merkleProof.root,
        p.merkleProof.siblings.map((s) => new proofProvider.merkle.MerkleProofEntry(s.hash, s.isLeft)),
      ),
    };
    const plain = toPlainProof(sdkShaped as never);
    expect(JSON.parse(JSON.stringify(plain))).toEqual(JSON.parse(JSON.stringify({ ...plain })));
    expect(diffProofs(plain, p).identical).toBe(true);
  });
});

describe("CachingBlockProvider", () => {
  test("fetches a block once and serves its transactions from memory", async () => {
    let blockCalls = 0;
    let txCalls = 0;
    const txs = ["0xAA", "0xbb"].map((hash) => ({ formatted: { hash } }));
    const inner = {
      getBlockNumber: async () => 100,
      getTransaction: async (hash: string) => {
        txCalls++;
        return { formatted: { hash } };
      },
      getBlockWithReceipts: async () => {
        blockCalls++;
        await new Promise((r) => setTimeout(r, 5));
        return { block: {}, transactions: txs, receipts: [] };
      },
    };
    const cached = new CachingBlockProvider(inner as never);

    await cached.getTransaction("0xaa"); // before the block is known: goes to the RPC
    await Promise.all([cached.getBlockWithReceipts(7), cached.getBlockWithReceipts(7)]);
    expect(blockCalls).toBe(1);

    const hit = await cached.getTransaction("0xAa");
    expect(hit).toBe(txs[0] as never);
    await cached.getTransaction("0xBB");
    expect(txCalls).toBe(1);
    expect(cached.calls).toEqual({ blockNumber: 0, transaction: 1, block: 1 });
  });
});

describe("recorded proof-diff evidence", () => {
  const path = resolve(REPO_ROOT, "evidence/proof-diff.jsonl");
  test.skipIf(!existsSync(path))("every recorded local build matched the hosted prover on inclusion", () => {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.inclusionIdentical, `${line.txHash}: ${line.differences?.join(", ")}`).toBe(true);
      if (!line.continuityIdentical) expect(line.localDigestAttested).toBe(true);
    }
  });
});
