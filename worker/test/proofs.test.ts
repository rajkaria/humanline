// Argument mapping from the real proof fixtures onto execute/executeBatch, plus batch-proof
// normalization. No network: everything comes from contracts/test/fixtures/*.json.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Interface } from "ethers";
import { ATTESTED_WORLD_ID_FRAGMENTS, loadAttestedWorldIdAbi } from "../src/abi";
import { REPO_ROOT, ACTION_ROOT_UPDATE } from "../src/config";
import { computeTxIndex } from "../src/cc3";
import {
  normalizeBatchProof,
  readProofFile,
  singleToBatch,
  toExecuteArgs,
  toExecuteBatchArgs,
  txIndexMatches,
  type SingleProof,
} from "../src/proofs";

const fixture = (name: string) =>
  readProofFile(resolve(REPO_ROOT, "contracts/test/fixtures", `${name}.json`));

const MAINNET = await fixture("mainnet-0x81ece311");
const SEPOLIA = await fixture("sepolia-0x36678603");

describe("fixtures", () => {
  test("mainnet fixture is the expected registerIdentities transaction", () => {
    expect(MAINNET.chainKey).toBe(3);
    expect(MAINNET.headerNumber).toBe(25959565);
    expect(MAINNET.txIndex).toBe(173);
    expect(MAINNET.txHash).toBe(
      "0x81ece3110019bf17255ee88a9728ce4327319d7622e528645e8253cf36fdc7e3",
    );
  });

  test("sepolia fixture is the expected staging transaction", () => {
    expect(SEPOLIA.chainKey).toBe(1);
    expect(SEPOLIA.headerNumber).toBe(11687163);
    expect(SEPOLIA.txIndex).toBe(58);
  });

  test("the proof's txIndex is reproducible from the Merkle path alone", () => {
    expect(computeTxIndex(MAINNET.merkleProof.siblings)).toBe(173);
    expect(computeTxIndex(SEPOLIA.merkleProof.siblings)).toBe(58);
    expect(txIndexMatches(MAINNET)).toBe(true);
    expect(txIndexMatches(SEPOLIA)).toBe(true);
  });
});

describe("toExecuteArgs", () => {
  test("maps proof JSON onto the ASCBase.execute parameter list", () => {
    const args = toExecuteArgs(MAINNET);
    expect(args[0]).toBe(ACTION_ROOT_UPDATE);
    expect(args[1]).toBe(MAINNET.chainKey);
    expect(args[2]).toBe(MAINNET.headerNumber);
    expect(args[3]).toBe(MAINNET.txBytes);
    // merkleRoot = merkleProof.root
    expect(args[4]).toBe(MAINNET.merkleProof.root);
    // siblings = merkleProof.siblings
    expect(args[5]).toHaveLength(MAINNET.merkleProof.siblings.length);
    expect(args[5][0]).toEqual({
      hash: MAINNET.merkleProof.siblings[0]!.hash,
      isLeft: MAINNET.merkleProof.siblings[0]!.isLeft,
    });
    // lowerEndpointDigest / continuityRoots = continuityProof.*
    expect(args[6]).toBe(MAINNET.continuityProof.lowerEndpointDigest);
    expect(args[7]).toEqual(MAINNET.continuityProof.roots);
  });

  test("the action discriminator is overridable", () => {
    expect(toExecuteArgs(MAINNET, 7)[0]).toBe(7);
  });

  test("the mapped args ABI-encode and round-trip through the interface", () => {
    const iface = loadAttestedWorldIdAbi().iface;
    const data = iface.encodeFunctionData("execute", toExecuteArgs(MAINNET));
    const decoded = iface.decodeFunctionData("execute", data);
    expect(Number(decoded[1])).toBe(3);
    expect(Number(decoded[2])).toBe(25959565);
    expect(decoded[4]).toBe(MAINNET.merkleProof.root);
    expect(decoded[5]).toHaveLength(9);
    expect(decoded[6]).toBe(MAINNET.continuityProof.lowerEndpointDigest);
    expect([...decoded[7]]).toEqual(MAINNET.continuityProof.roots);
  });

  test("calldata is larger than the encoded transaction it carries", () => {
    const iface = new Interface([...ATTESTED_WORLD_ID_FRAGMENTS]);
    const data = iface.encodeFunctionData("execute", toExecuteArgs(SEPOLIA));
    const size = (data.length - 2) / 2;
    expect(size).toBeGreaterThan((SEPOLIA.txBytes.length - 2) / 2);
    expect(size).toBeLessThan(120_000); // well under any sane RPC payload cap
  });
});

describe("toExecuteBatchArgs", () => {
  const batch = {
    chainKey: 1,
    fromHeader: SEPOLIA.headerNumber,
    toHeader: SEPOLIA.headerNumber + 10,
    continuityProof: SEPOLIA.continuityProof,
    members: [
      {
        txHash: SEPOLIA.txHash,
        blockHeight: SEPOLIA.headerNumber,
        txIndex: SEPOLIA.txIndex,
        txBytes: SEPOLIA.txBytes,
        merkleProof: SEPOLIA.merkleProof,
      },
      {
        txHash: MAINNET.txHash,
        blockHeight: SEPOLIA.headerNumber + 10,
        txIndex: 4,
        txBytes: MAINNET.txBytes,
        merkleProof: MAINNET.merkleProof,
      },
    ],
  };

  test("parallel arrays stay index-aligned and the continuity proof is shared", () => {
    const [chainKey, heights, txBytes, merkleProofs, shared] = toExecuteBatchArgs(batch);
    expect(chainKey).toBe(1);
    expect(heights).toEqual([SEPOLIA.headerNumber, SEPOLIA.headerNumber + 10]);
    expect(txBytes).toEqual([SEPOLIA.txBytes, MAINNET.txBytes]);
    expect(merkleProofs[0]!.root).toBe(SEPOLIA.merkleProof.root);
    expect(merkleProofs[1]!.root).toBe(MAINNET.merkleProof.root);
    expect(shared.lowerEndpointDigest).toBe(SEPOLIA.continuityProof.lowerEndpointDigest);
    expect(shared.roots).toEqual(SEPOLIA.continuityProof.roots);
  });

  test("the batch args ABI-encode against the executeBatch fragment", () => {
    const iface = loadAttestedWorldIdAbi().iface;
    const data = iface.encodeFunctionData("executeBatch", toExecuteBatchArgs(batch));
    const decoded = iface.decodeFunctionData("executeBatch", data);
    expect([...decoded[1]].map(Number)).toEqual([SEPOLIA.headerNumber, SEPOLIA.headerNumber + 10]);
    expect(decoded[3][0][0]).toBe(SEPOLIA.merkleProof.root);
    expect(decoded[4][0]).toBe(SEPOLIA.continuityProof.lowerEndpointDigest);
  });
});

describe("singleToBatch", () => {
  test("a single proof becomes a one-member batch with the same arguments", () => {
    const batch = singleToBatch(MAINNET);
    expect(batch.members).toHaveLength(1);
    expect(batch.fromHeader).toBe(batch.toHeader);
    expect(batch.members[0]!.txIndex).toBe(173);
    expect(batch.continuityProof).toBe(MAINNET.continuityProof);
  });
});

describe("normalizeBatchProof", () => {
  const entry = (p: SingleProof) => ({
    txHash: p.txHash,
    txBytes: p.txBytes,
    merkleProof: p.merkleProof,
  });

  const raw = {
    chainKey: 1,
    fromHeader: 100,
    toHeader: 200,
    continuityProof: SEPOLIA.continuityProof,
    merkleProofs: {
      "200": { "4": entry(MAINNET) },
      "100": { "58": entry(SEPOLIA) },
    },
  };

  test("flattens nested plain objects into (blockHeight, txIndex) order", () => {
    const out = normalizeBatchProof(raw, [SEPOLIA.txHash, MAINNET.txHash]);
    expect(out.members.map((m) => [m.blockHeight, m.txIndex])).toEqual([
      [100, 58],
      [200, 4],
    ]);
    expect(out.members[0]!.txHash).toBe(SEPOLIA.txHash);
  });

  test("accepts the SDK's nested Maps as well as plain objects", () => {
    const asMaps = {
      ...raw,
      merkleProofs: new Map([
        [200, new Map([[4, entry(MAINNET)]])],
        [100, new Map([[58, entry(SEPOLIA)]])],
      ]),
    };
    const out = normalizeBatchProof(asMaps, [SEPOLIA.txHash, MAINNET.txHash]);
    expect(out.members.map((m) => m.blockHeight)).toEqual([100, 200]);
  });

  test("ordering is by (blockHeight, txIndex), not insertion order", () => {
    const sameBlock = {
      ...raw,
      merkleProofs: { "100": { "58": entry(SEPOLIA), "4": entry(MAINNET) } },
    };
    const out = normalizeBatchProof(sameBlock, [MAINNET.txHash, SEPOLIA.txHash]);
    expect(out.members.map((m) => m.txIndex)).toEqual([4, 58]);
  });

  test("refuses a batch that is missing a requested transaction", () => {
    expect(() => normalizeBatchProof(raw, [SEPOLIA.txHash, MAINNET.txHash, "0xdead"])).toThrow(
      /missing 1 tx/,
    );
  });

  test("refuses a batch containing a transaction we did not ask for", () => {
    expect(() => normalizeBatchProof(raw, [SEPOLIA.txHash])).toThrow(/unexpected/);
  });

  test("hash comparison is case-insensitive", () => {
    const out = normalizeBatchProof(raw, [
      SEPOLIA.txHash.toUpperCase().replace("0X", "0x"),
      MAINNET.txHash,
    ]);
    expect(out.members).toHaveLength(2);
  });
});
