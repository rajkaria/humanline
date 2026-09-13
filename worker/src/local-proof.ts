// Prover independence: build Attestcoin proofs locally from any Ethereum RPC with usc-sdk's
// RawProofBuilder + SimpleBlockProvider, compare them byte for byte with the hosted proof builder,
// and fall back to the hosted builder when a local build is not possible.
//
// The hosted prover is a convenience, not a trust assumption: BlockProver 0x0FD2 checks every proof
// on-chain. Building locally removes it as a *liveness* dependency too.
import { JsonRpcProvider, keccak256, solidityPacked } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { cc3Provider, computeTxIndex, proofBuilder } from "./cc3";
import { fetchProof, type SingleProof } from "./proofs";

type BlockProvider = proofProvider.raw.blockProvider.BlockProvider;
type BlockWithReceipts = proofProvider.raw.blockProvider.BlockWithReceipts;
type TransactionWithRaw = NonNullable<Awaited<ReturnType<BlockProvider["getTransaction"]>>>;

// ---------------------------------------------------------------------------
// Block provider cache
// ---------------------------------------------------------------------------

/**
 * Wraps any `BlockProvider` so a block is fetched once and every transaction in it is then served
 * from memory. `RawProofBuilder` asks for each transaction of the proved block individually, which
 * for a 150-transaction block is 150 RPC calls; after the block itself is fetched this is zero.
 */
export class CachingBlockProvider implements BlockProvider {
  private readonly blocks = new Map<number, Promise<BlockWithReceipts | null>>();
  private readonly txs = new Map<string, TransactionWithRaw>();
  calls = { blockNumber: 0, transaction: 0, block: 0 };

  constructor(private readonly inner: BlockProvider) {}

  getBlockNumber(): Promise<number> {
    this.calls.blockNumber++;
    return this.inner.getBlockNumber();
  }

  async getTransaction(transactionHash: string): Promise<TransactionWithRaw | null> {
    const hit = this.txs.get(transactionHash.toLowerCase());
    if (hit) return hit;
    this.calls.transaction++;
    return this.inner.getTransaction(transactionHash);
  }

  getBlockWithReceipts(blockNumber: number): Promise<BlockWithReceipts | null> {
    let pending = this.blocks.get(blockNumber);
    if (!pending) {
      this.calls.block++;
      pending = this.inner.getBlockWithReceipts(blockNumber).then((result) => {
        for (const tx of result?.transactions ?? []) {
          const hash = tx.formatted.hash?.toLowerCase();
          if (hash) this.txs.set(hash, tx);
        }
        return result;
      });
      this.blocks.set(blockNumber, pending);
    }
    return pending;
  }
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export interface LocalProofOptions {
  sourceRpcUrl: string;
  cc3RpcUrl?: string;
  /** Silence usc-sdk's progress logging (default true). */
  quiet?: boolean;
}

/** Plain JSON (the SDK returns class instances) in exactly the hosted builder's shape. */
export function toPlainProof(data: {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: string;
  txBytes: string;
  merkleProof: { root: string; siblings: Array<{ hash: string; isLeft: boolean }> };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
}): SingleProof {
  return {
    chainKey: Number(data.chainKey),
    headerNumber: Number(data.headerNumber),
    txIndex: Number(data.txIndex),
    txHash: data.txHash,
    txBytes: data.txBytes,
    merkleProof: {
      root: data.merkleProof.root,
      siblings: data.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: Boolean(s.isLeft) })),
    },
    continuityProof: {
      lowerEndpointDigest: data.continuityProof.lowerEndpointDigest,
      roots: [...data.continuityProof.roots],
    },
  };
}

export async function buildLocalProof(chainKey: number, txHash: string, opts: LocalProofOptions): Promise<SingleProof> {
  const source = new JsonRpcProvider(opts.sourceRpcUrl, undefined, { staticNetwork: true });
  const blocks = new CachingBlockProvider(new proofProvider.raw.blockProvider.SimpleBlockProvider(source));
  const info = new chainInfo.PrecompileChainInfoProvider(cc3Provider(opts.cc3RpcUrl));
  const builder = new proofProvider.raw.RawProofBuilder(chainKey, blocks, info, proofProvider.raw.EncodingVersion.V1);

  const restore = console.log;
  if (opts.quiet !== false) console.log = () => {};
  try {
    const result = await builder.getProof(txHash);
    if (!result.success || !result.data) throw new Error(`local proof failed: ${result.error ?? "unknown error"}`);
    return toPlainProof(result.data as never);
  } finally {
    console.log = restore;
    source.destroy();
  }
}

export type ProofSource = "local" | "hosted";

/** Local first, hosted on failure or timeout; says which one answered and why. */
export async function proveWithFallback(
  chainKey: number,
  txHash: string,
  opts: LocalProofOptions & { timeoutMs?: number; prefer?: ProofSource },
): Promise<{ proof: SingleProof; via: ProofSource; localError?: string }> {
  if (opts.prefer === "hosted") return { proof: await fetchProof(proofBuilder(chainKey), txHash), via: "hosted" };
  const timeoutMs = opts.timeoutMs ?? 180_000;
  try {
    const proof = await Promise.race([
      buildLocalProof(chainKey, txHash, opts),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`local build exceeded ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { proof, via: "local" };
  } catch (error) {
    const proof = await fetchProof(proofBuilder(chainKey), txHash);
    return { proof, via: "hosted", localError: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Verifying (the arithmetic BlockProver 0x0FD2 performs)
// ---------------------------------------------------------------------------

export const leafHash = (txBytes: string) => keccak256(solidityPacked(["uint8", "bytes"], [0, txBytes]));
export const innerHash = (left: string, right: string) =>
  keccak256(solidityPacked(["uint8", "bytes32", "bytes32"], [1, left, right]));

/** Fold a Merkle path: sibling `isLeft` means the sibling sits on the left. */
export function merkleRootOf(txBytes: string, siblings: ReadonlyArray<{ hash: string; isLeft: boolean }>): string {
  let node = leafHash(txBytes);
  for (const s of siblings) node = s.isLeft ? innerHash(s.hash, node) : innerHash(node, s.hash);
  return node;
}

export function verifyInclusion(proof: SingleProof): { ok: boolean; reason?: string } {
  if (merkleRootOf(proof.txBytes, proof.merkleProof.siblings).toLowerCase() !== proof.merkleProof.root.toLowerCase()) {
    return { ok: false, reason: "Merkle path does not reach the block's transaction root" };
  }
  if (computeTxIndex(proof.merkleProof.siblings) !== proof.txIndex) {
    return { ok: false, reason: "Merkle path encodes a different transaction index" };
  }
  if (proof.continuityProof.roots[0]?.toLowerCase() !== proof.merkleProof.root.toLowerCase()) {
    return { ok: false, reason: "the continuity chain does not start at this block's root" };
  }
  return { ok: true };
}

/** `digest_h = keccak(uint64 h ‖ root_h ‖ digest_{h-1})` from the lower endpoint up. */
export function foldContinuity(proof: Pick<SingleProof, "headerNumber" | "continuityProof">): {
  upperHeight: number;
  digest: string;
} {
  let digest = proof.continuityProof.lowerEndpointDigest;
  proof.continuityProof.roots.forEach((root, i) => {
    digest = keccak256(solidityPacked(["uint64", "bytes32", "bytes32"], [proof.headerNumber + i, root, digest]));
  });
  return { upperHeight: proof.headerNumber + proof.continuityProof.roots.length - 1, digest };
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

export interface ProofDiff {
  identical: boolean;
  /** Transaction bytes, block, index and Merkle path: must always agree. */
  inclusionIdentical: boolean;
  /** Continuity proof: agrees when both were built against the same attestation bounds. */
  continuityIdentical: boolean;
  differences: string[];
}

const lc = (v: string) => v.toLowerCase();

export function diffProofs(local: SingleProof, hosted: SingleProof): ProofDiff {
  const inclusion: string[] = [];
  const continuity: string[] = [];
  if (local.chainKey !== hosted.chainKey) inclusion.push(`chainKey ${local.chainKey} ≠ ${hosted.chainKey}`);
  if (lc(local.txHash) !== lc(hosted.txHash)) inclusion.push("txHash");
  if (local.headerNumber !== hosted.headerNumber) inclusion.push(`headerNumber ${local.headerNumber} ≠ ${hosted.headerNumber}`);
  if (local.txIndex !== hosted.txIndex) inclusion.push(`txIndex ${local.txIndex} ≠ ${hosted.txIndex}`);
  if (lc(local.txBytes) !== lc(hosted.txBytes)) {
    const a = lc(local.txBytes);
    const b = lc(hosted.txBytes);
    let at = 0;
    while (at < a.length && a[at] === b[at]) at++;
    inclusion.push(`txBytes differ from byte ${Math.max(0, (at - 2) >> 1)} (${(a.length - 2) / 2} vs ${(b.length - 2) / 2} bytes)`);
  }
  if (lc(local.merkleProof.root) !== lc(hosted.merkleProof.root)) inclusion.push("merkleProof.root");
  const ls = local.merkleProof.siblings;
  const hs = hosted.merkleProof.siblings;
  if (ls.length !== hs.length) inclusion.push(`siblings length ${ls.length} ≠ ${hs.length}`);
  else ls.forEach((s, i) => {
    if (lc(s.hash) !== lc(hs[i]!.hash) || s.isLeft !== hs[i]!.isLeft) inclusion.push(`sibling ${i}`);
  });

  if (lc(local.continuityProof.lowerEndpointDigest) !== lc(hosted.continuityProof.lowerEndpointDigest)) {
    continuity.push("continuityProof.lowerEndpointDigest");
  }
  const lr = local.continuityProof.roots;
  const hr = hosted.continuityProof.roots;
  if (lr.length !== hr.length) continuity.push(`continuity roots ${lr.length} ≠ ${hr.length}`);
  else lr.forEach((r, i) => {
    if (lc(r) !== lc(hr[i]!)) continuity.push(`continuity root ${i}`);
  });

  return {
    identical: inclusion.length === 0 && continuity.length === 0,
    inclusionIdentical: inclusion.length === 0,
    continuityIdentical: continuity.length === 0,
    differences: [...inclusion, ...continuity],
  };
}
