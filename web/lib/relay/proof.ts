/**
 * Attestcoin proof builder JSON → `AttestedWorldID.executeBatch` arguments.
 *
 * The builder serves one proof per transaction (`GET /api/v1/proof-by-tx`) and a
 * shared-continuity batch (`POST /api/v1/proof-batch-by-tx`, body = JSON array of
 * hashes). A batch's `merkleProofs` is nested `{ height: { txIndex: entry } }`.
 * Both shapes are normalised into one ordered member list so every relay, one root
 * or ten, goes through `executeBatch`.
 *
 * Pure and strict: a proof that is missing a requested transaction, carries an
 * extra one, or disagrees with its own Merkle path is rejected here, before a
 * wallet is ever asked to sign.
 */

import type { Hex } from "viem";

export type MerkleSibling = { hash: Hex; isLeft: boolean };
export type MerkleProof = { root: Hex; siblings: MerkleSibling[] };
export type ContinuityProof = { lowerEndpointDigest: Hex; roots: Hex[] };

/** `GET /api/v1/proof-by-tx/{chainKey}/{hash}` data. */
export type SingleProofJson = {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: string;
  txBytes: string;
  merkleProof: { root: string; siblings: Array<{ hash: string; isLeft: boolean }> };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
};

type BatchEntryJson = {
  txHash: string;
  txBytes: string;
  merkleProof: { root: string; siblings: Array<{ hash: string; isLeft: boolean }> };
};

/** `POST /api/v1/proof-batch-by-tx/{chainKey}` data. */
export type BatchProofJson = {
  chainKey: number;
  fromHeader: number;
  toHeader: number;
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
  merkleProofs: Record<string, Record<string, BatchEntryJson>>;
};

export type BatchMember = {
  txHash: Hex;
  blockHeight: number;
  txIndex: number;
  txBytes: Hex;
  merkleProof: MerkleProof;
};

export type NormalizedBatch = {
  chainKey: number;
  members: BatchMember[];
  continuityProof: ContinuityProof;
};

/** Exactly the tuple `executeBatch(uint64,uint64[],bytes[],MerkleProof[],ContinuityProof)` takes. */
export type ExecuteBatchArgs = readonly [
  bigint,
  readonly bigint[],
  readonly Hex[],
  readonly MerkleProof[],
  ContinuityProof,
];

const HEX = /^0x[0-9a-fA-F]*$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

function hex(value: string, what: string): Hex {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`${what} is not hex`);
  return value.toLowerCase() as Hex;
}

function bytes32(value: string, what: string): Hex {
  if (typeof value !== "string" || !BYTES32.test(value)) throw new Error(`${what} is not bytes32`);
  return value.toLowerCase() as Hex;
}

function merkle(proof: BatchEntryJson["merkleProof"], what: string): MerkleProof {
  if (!proof || !Array.isArray(proof.siblings)) throw new Error(`${what}: malformed Merkle proof`);
  return {
    root: bytes32(proof.root, `${what} Merkle root`),
    siblings: proof.siblings.map((s, i) => ({
      hash: bytes32(s.hash, `${what} sibling ${i}`),
      isLeft: Boolean(s.isLeft),
    })),
  };
}

function continuity(proof: SingleProofJson["continuityProof"]): ContinuityProof {
  if (!proof || !Array.isArray(proof.roots)) throw new Error("malformed continuity proof");
  return {
    lowerEndpointDigest: bytes32(proof.lowerEndpointDigest, "lower endpoint digest"),
    roots: proof.roots.map((r, i) => bytes32(r, `continuity root ${i}`)),
  };
}

/**
 * The transaction index a Merkle path encodes: sibling `i` sitting on the left means
 * bit `i` is set. Same arithmetic as BlockProver `calculateTxIndex` (and the worker's
 * `computeTxIndex`), which the contract uses as the replay key.
 */
export function txIndexFromSiblings(siblings: readonly MerkleSibling[]): number {
  let index = 0;
  siblings.forEach((s, i) => {
    if (s.isLeft) index += 2 ** i;
  });
  return index;
}

function assertExact(members: BatchMember[], expected: readonly string[]) {
  const got = new Set(members.map((m) => m.txHash));
  const want = new Set(expected.map((h) => h.toLowerCase()));
  const missing = [...want].filter((h) => !got.has(h as Hex));
  if (missing.length > 0) throw new Error(`proof is missing ${missing.length} transaction(s): ${missing.join(", ")}`);
  const extra = [...got].filter((h) => !want.has(h));
  if (extra.length > 0) throw new Error(`proof carries ${extra.length} unexpected transaction(s)`);
}

function assertPaths(members: BatchMember[]) {
  for (const m of members) {
    const derived = txIndexFromSiblings(m.merkleProof.siblings);
    if (derived !== m.txIndex) {
      throw new Error(`Merkle path for ${m.txHash} encodes index ${derived}, not ${m.txIndex}`);
    }
  }
}

export function normalizeSingle(data: SingleProofJson, expectedHash?: string): NormalizedBatch {
  const member: BatchMember = {
    txHash: bytes32(data.txHash, "txHash"),
    blockHeight: Number(data.headerNumber),
    txIndex: Number(data.txIndex),
    txBytes: hex(data.txBytes, "txBytes"),
    merkleProof: merkle(data.merkleProof, data.txHash),
  };
  const members = [member];
  if (expectedHash) assertExact(members, [expectedHash]);
  assertPaths(members);
  return { chainKey: Number(data.chainKey), members, continuityProof: continuity(data.continuityProof) };
}

export function normalizeBatch(data: BatchProofJson, expectedHashes: readonly string[]): NormalizedBatch {
  if (!data?.merkleProofs || typeof data.merkleProofs !== "object") {
    throw new Error("batch proof has no merkleProofs");
  }
  const members: BatchMember[] = [];
  for (const [height, byIndex] of Object.entries(data.merkleProofs)) {
    for (const [txIndex, entry] of Object.entries(byIndex)) {
      members.push({
        txHash: bytes32(entry.txHash, "txHash"),
        blockHeight: Number(height),
        txIndex: Number(txIndex),
        txBytes: hex(entry.txBytes, "txBytes"),
        merkleProof: merkle(entry.merkleProof, entry.txHash),
      });
    }
  }
  // getBatchProof answers in height order; the contract requires non-decreasing heights.
  members.sort((a, b) => a.blockHeight - b.blockHeight || a.txIndex - b.txIndex);
  assertExact(members, expectedHashes);
  assertPaths(members);
  return { chainKey: Number(data.chainKey), members, continuityProof: continuity(data.continuityProof) };
}

export function toExecuteBatchArgs(batch: NormalizedBatch): ExecuteBatchArgs {
  return [
    BigInt(batch.chainKey),
    batch.members.map((m) => BigInt(m.blockHeight)),
    batch.members.map((m) => m.txBytes),
    batch.members.map((m) => m.merkleProof),
    batch.continuityProof,
  ] as const;
}

/** JSON-safe form of the args for an API response (uint64s as decimal strings). */
export type ExecuteBatchArgsJson = [string, string[], Hex[], MerkleProof[], ContinuityProof];

export function argsToJson(args: ExecuteBatchArgs): ExecuteBatchArgsJson {
  return [
    args[0].toString(),
    args[1].map((h) => h.toString()),
    [...args[2]],
    [...args[3]],
    args[4],
  ];
}

export function argsFromJson(json: ExecuteBatchArgsJson): ExecuteBatchArgs {
  if (!Array.isArray(json) || json.length !== 5) throw new Error("malformed executeBatch args");
  return [BigInt(json[0]), json[1].map((h) => BigInt(h)), json[2], json[3], json[4]] as const;
}

/** Rough calldata size in bytes, for the "what you are about to sign" summary. */
export function proofBytes(batch: NormalizedBatch): number {
  let bytes = 0;
  for (const m of batch.members) bytes += (m.txBytes.length - 2) / 2 + m.merkleProof.siblings.length * 64 + 32;
  return bytes + 32 + batch.continuityProof.roots.length * 32;
}
