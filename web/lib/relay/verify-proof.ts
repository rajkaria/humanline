/**
 * In-browser proof verification: before a wallet signs anything, re-derive what BlockProver
 * `0x0FD2` will check from the exact bytes about to be sent.
 *
 *   1. Inclusion. Each transaction's leaf `keccak(0x00 ‖ txBytes)` folds up its Merkle path
 *      (`keccak(0x01 ‖ left ‖ right)`) to the block's transaction root, and the path's left/right
 *      flags encode the claimed transaction index.
 *   2. Continuity. That root is the continuity root at the block's height, and the digest chain
 *      `digest_h = keccak(uint64 h ‖ root_h ‖ digest_{h-1})` folds from the lower endpoint to an
 *      upper height.
 *   3. Attestation. The folded digest is the one Creditcoin's attestors signed at that height, read
 *      from ChainInfo `0x0FD3` (`get_attestation_bounds`, else `get_checkpoint_for_height`).
 *
 * Steps 1-2 are pure, so a forged receipt is refused with no network at all. Step 3 is one view
 * call. Nothing the proof builder or our server says is taken on its word.
 */

import { encodePacked, keccak256, type Hex, type PublicClient } from "viem";

import { PRECOMPILES } from "@/lib/chains";
import { txIndexFromSiblings, type ContinuityProof, type ExecuteBatchArgs, type MerkleProof } from "@/lib/relay/proof";

export const chainInfoContinuityAbi = [
  {
    type: "function",
    name: "get_attestation_bounds",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "targetHeight", type: "uint64" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "parentHeight", type: "uint64" },
          { name: "parentHash", type: "bytes32" },
          { name: "parentIsAttestation", type: "bool" },
          { name: "childHeight", type: "uint64" },
          { name: "childHash", type: "bytes32" },
          { name: "childIsAttestation", type: "bool" },
          { name: "isAttested", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "get_checkpoint_for_height",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "height", type: "uint64" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "hash", type: "bytes32" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

export type ProofMember = { blockHeight: number; txBytes: Hex; merkleProof: MerkleProof; txIndex?: number };

export type LocalCheck =
  | { ok: true; baseHeight: number; upperHeight: number; digest: Hex }
  | { ok: false; reason: string };

export type BrowserCheck =
  | { ok: true; upperHeight: number; digest: Hex; via: "attestation" | "checkpoint" }
  | { ok: false; reason: string };

const lower = (h: string) => h.toLowerCase();

export function leafHash(txBytes: Hex): Hex {
  return keccak256(encodePacked(["uint8", "bytes"], [0, txBytes]));
}

export function merkleRootOf(txBytes: Hex, siblings: MerkleProof["siblings"]): Hex {
  let node = leafHash(txBytes);
  for (const s of siblings) {
    node = keccak256(encodePacked(["uint8", "bytes32", "bytes32"], s.isLeft ? [1, s.hash, node] : [1, node, s.hash]));
  }
  return node;
}

export function foldContinuity(baseHeight: number, continuity: ContinuityProof): { upperHeight: number; digest: Hex } {
  let digest = continuity.lowerEndpointDigest;
  continuity.roots.forEach((root, i) => {
    digest = keccak256(encodePacked(["uint64", "bytes32", "bytes32"], [BigInt(baseHeight + i), root, digest]));
  });
  return { upperHeight: baseHeight + continuity.roots.length - 1, digest };
}

/** Steps 1-2 for one proof or a shared-continuity batch. Pure. */
export function verifyLocally(members: readonly ProofMember[], continuity: ContinuityProof): LocalCheck {
  if (members.length === 0) return { ok: false, reason: "the proof carries no transactions" };
  if (continuity.roots.length === 0) return { ok: false, reason: "the continuity proof is empty" };
  const baseHeight = Math.min(...members.map((m) => m.blockHeight));

  for (const m of members) {
    const root = merkleRootOf(m.txBytes, m.merkleProof.siblings);
    if (lower(root) !== lower(m.merkleProof.root)) {
      return { ok: false, reason: `the Merkle path for block ${m.blockHeight} does not reach its transaction root (forged or altered transaction bytes)` };
    }
    if (m.txIndex !== undefined && txIndexFromSiblings(m.merkleProof.siblings) !== m.txIndex) {
      return { ok: false, reason: `the Merkle path for block ${m.blockHeight} encodes a different transaction index` };
    }
    const at = m.blockHeight - baseHeight;
    if (at >= continuity.roots.length || lower(continuity.roots[at]!) !== lower(root)) {
      return { ok: false, reason: `block ${m.blockHeight}'s transaction root is not in the continuity chain` };
    }
  }
  return { ok: true, baseHeight, ...foldContinuity(baseHeight, continuity) };
}

/** Step 3: is the folded digest the one Creditcoin's attestors signed at `upperHeight`? */
export async function digestIsAttested(
  client: PublicClient,
  chainKey: number,
  baseHeight: number,
  upperHeight: number,
  digest: Hex,
): Promise<"attestation" | "checkpoint" | null> {
  const bounds = await client.readContract({
    address: PRECOMPILES.chainInfo,
    abi: chainInfoContinuityAbi,
    functionName: "get_attestation_bounds",
    args: [BigInt(chainKey), BigInt(baseHeight)],
  });
  if (bounds.isAttested && Number(bounds.childHeight) === upperHeight && lower(bounds.childHash) === lower(digest)) {
    return bounds.childIsAttestation ? "attestation" : "checkpoint";
  }
  const checkpoint = await client.readContract({
    address: PRECOMPILES.chainInfo,
    abi: chainInfoContinuityAbi,
    functionName: "get_checkpoint_for_height",
    args: [BigInt(chainKey), BigInt(upperHeight)],
  });
  return checkpoint.exists && lower(checkpoint.hash) === lower(digest) ? "checkpoint" : null;
}

async function check(client: PublicClient, chainKey: number, members: readonly ProofMember[], continuity: ContinuityProof): Promise<BrowserCheck> {
  const local = verifyLocally(members, continuity);
  if (!local.ok) return local;
  const via = await digestIsAttested(client, chainKey, local.baseHeight, local.upperHeight, local.digest);
  if (!via) {
    return {
      ok: false,
      reason: `the continuity chain ends at a digest Creditcoin's attestors never signed for block ${local.upperHeight}`,
    };
  }
  return { ok: true, upperHeight: local.upperHeight, digest: local.digest, via };
}

/** `AttestedWorldID.executeBatch` / `RelayReward.relay` arguments. */
export function verifyBatchInBrowser(client: PublicClient, args: ExecuteBatchArgs): Promise<BrowserCheck> {
  const [chainKey, heights, txBytes, merkleProofs, continuity] = args;
  const members = heights.map((h, i) => ({ blockHeight: Number(h), txBytes: txBytes[i]!, merkleProof: merkleProofs[i]! }));
  return check(client, Number(chainKey), members, continuity);
}

/** A `SourceProof` struct (HumanLinks, CreditHistory, EthRepay). */
export function verifySourceProofInBrowser(
  client: PublicClient,
  proof: { chainKey: bigint; blockHeight: bigint; encodedTransaction: Hex; merkleProof: MerkleProof; continuityProof: ContinuityProof },
  txIndex?: number,
): Promise<BrowserCheck> {
  return check(
    client,
    Number(proof.chainKey),
    [{ blockHeight: Number(proof.blockHeight), txBytes: proof.encodedTransaction, merkleProof: proof.merkleProof, txIndex }],
    proof.continuityProof,
  );
}
