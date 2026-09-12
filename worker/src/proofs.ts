// Proof fetching from the Attestcoin proof builder, plus the mapping from proof JSON onto
// the `execute` / `executeBatch` argument lists. The mapping functions are pure so they can
// be tested against the real fixtures in contracts/test/fixtures/ with no network.
import type { proofProvider } from "@gluwa/usc-sdk";
import { ACTION_ROOT_UPDATE } from "./config";
import { computeTxIndex, type MerkleSibling } from "./cc3";

export interface MerkleProofJson {
  root: string;
  siblings: MerkleSibling[];
}

export interface ContinuityProofJson {
  lowerEndpointDigest: string;
  roots: string[];
}

/** The shape of both `getProof().data` and contracts/test/fixtures/*.json. */
export interface SingleProof {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: string;
  txBytes: string;
  merkleProof: MerkleProofJson;
  continuityProof: ContinuityProofJson;
  cached?: boolean;
  generatedAt?: string | Date;
}

/** One member of a batch proof: shares the batch's continuity proof. */
export interface BatchMember {
  txHash: string;
  blockHeight: number;
  txIndex: number;
  txBytes: string;
  merkleProof: MerkleProofJson;
}

export interface NormalizedBatchProof {
  chainKey: number;
  fromHeader: number;
  toHeader: number;
  members: BatchMember[];
  continuityProof: ContinuityProofJson;
  cached?: boolean;
}

// ---------------------------------------------------------------------------
// Argument mapping (docs/PLAN.md Interfaces + brief §4)
// ---------------------------------------------------------------------------

export type ExecuteArgs = [
  number, // action
  number, // chainKey
  number, // blockHeight
  string, // encodedTransaction
  string, // merkleRoot
  MerkleSibling[], // siblings
  string, // lowerEndpointDigest
  string[], // continuityRoots
];

/** merkleRoot = merkleProof.root, siblings = merkleProof.siblings, etc. */
export function toExecuteArgs(proof: SingleProof, action = ACTION_ROOT_UPDATE): ExecuteArgs {
  return [
    action,
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  ];
}

export type ExecuteBatchArgs = [
  number, // chainKey
  number[], // blockHeights
  string[], // encodedTransactions
  Array<{ root: string; siblings: MerkleSibling[] }>, // merkleProofs
  { lowerEndpointDigest: string; roots: string[] }, // sharedContinuityProof
];

export function toExecuteBatchArgs(batch: NormalizedBatchProof): ExecuteBatchArgs {
  return [
    batch.chainKey,
    batch.members.map((m) => m.blockHeight),
    batch.members.map((m) => m.txBytes),
    batch.members.map((m) => ({
      root: m.merkleProof.root,
      siblings: m.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    })),
    {
      lowerEndpointDigest: batch.continuityProof.lowerEndpointDigest,
      roots: batch.continuityProof.roots,
    },
  ];
}

/** Turns a set of single proofs into the equivalent single-member batches. */
export function singleToBatch(proof: SingleProof): NormalizedBatchProof {
  return {
    chainKey: proof.chainKey,
    fromHeader: proof.headerNumber,
    toHeader: proof.headerNumber,
    continuityProof: proof.continuityProof,
    members: [
      {
        txHash: proof.txHash,
        blockHeight: proof.headerNumber,
        txIndex: proof.txIndex,
        txBytes: proof.txBytes,
        merkleProof: proof.merkleProof,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Batch-proof normalization
// ---------------------------------------------------------------------------

interface BatchEntryRaw {
  txHash: string;
  txBytes: string;
  merkleProof: MerkleProofJson;
}

type NumberKeyed<V> = Map<number, V> | Record<string, V>;

/** The SDK returns nested Maps; a JSON round-trip turns them into plain objects. Accept both. */
type BatchMerkleProofsRaw = NumberKeyed<NumberKeyed<BatchEntryRaw>>;

function entriesOf<V>(m: NumberKeyed<V>): Array<[number, V]> {
  if (m instanceof Map) return [...m.entries()].map(([k, v]): [number, V] => [Number(k), v]);
  return Object.entries(m).map(([k, v]): [number, V] => [Number(k), v]);
}

/**
 * Flattens `getBatchProof` output (blockHeight -> txIndex -> entry) into an ordered member
 * list. Ordering is by (blockHeight, txIndex), i.e. exact source-chain order.
 *
 * Throws when a requested hash is missing, so a partial batch can never be submitted as if
 * it were complete — the caller falls back to per-tx proofs.
 */
export function normalizeBatchProof(
  data: {
    chainKey: number;
    fromHeader: number;
    toHeader: number;
    continuityProof: ContinuityProofJson;
    merkleProofs: BatchMerkleProofsRaw;
    cached?: boolean;
  },
  expectedHashes: string[],
): NormalizedBatchProof {
  const members: BatchMember[] = [];
  for (const [blockHeight, byIndex] of entriesOf(data.merkleProofs)) {
    for (const [txIndex, e] of entriesOf(byIndex)) {
      members.push({
        txHash: e.txHash,
        blockHeight,
        txIndex,
        txBytes: e.txBytes,
        merkleProof: e.merkleProof,
      });
    }
  }
  members.sort((a, b) => a.blockHeight - b.blockHeight || a.txIndex - b.txIndex);

  const got = new Set(members.map((m) => m.txHash.toLowerCase()));
  const missing = expectedHashes.filter((h) => !got.has(h.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(`batch proof is missing ${missing.length} tx(s): ${missing.join(", ")}`);
  }
  const extra = members.filter((m) => !expectedHashes.some((h) => h.toLowerCase() === m.txHash.toLowerCase()));
  if (extra.length > 0) {
    throw new Error(`batch proof contains ${extra.length} unexpected tx(s)`);
  }

  return {
    chainKey: data.chainKey,
    fromHeader: data.fromHeader,
    toHeader: data.toHeader,
    members,
    continuityProof: data.continuityProof,
    cached: data.cached,
  };
}

/** Cross-checks the proof's own txIndex against the one derivable from the Merkle path. */
export function txIndexMatches(proof: SingleProof): boolean {
  return computeTxIndex(proof.merkleProof.siblings) === proof.txIndex;
}

// ---------------------------------------------------------------------------
// Network wrappers
// ---------------------------------------------------------------------------

type Builder = InstanceType<typeof proofProvider.service.ProofBuilder>;

export async function fetchProof(builder: Builder, txHash: string): Promise<SingleProof> {
  const res = await builder.getProof(txHash);
  if (!res.success || !res.data) {
    throw new Error(`getProof(${txHash}) failed: ${res.error ?? "unknown error"}`);
  }
  return res.data as unknown as SingleProof;
}

export async function fetchBatchProof(
  builder: Builder,
  txHashes: string[],
): Promise<NormalizedBatchProof> {
  const res = await builder.getBatchProof(txHashes);
  if (!res.success || !res.data) {
    throw new Error(`getBatchProof(${txHashes.length} txs) failed: ${res.error ?? "unknown error"}`);
  }
  return normalizeBatchProof(res.data as never, txHashes);
}

/** Reads a fixture/proof JSON file (used by tests and `prove --proof-file`). */
export async function readProofFile(path: string): Promise<SingleProof> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as SingleProof;
}
