/**
 * Compose the network reads into a relay plan. Server-only.
 *
 * Shared by `/api/relay/plan` (a user's self-relay) and the scheduled relay route,
 * so the operator and any user walk exactly the same chain of updates.
 */

import type { Hex, PublicClient } from "viem";

import { attestedWorldIdAbi } from "@/lib/abi";
import type { SourceChainKey } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import { planRelay, type RelayPlan, type TreeChange } from "@/lib/relay/plan";
import {
  findChangeByPostRoot,
  isHeightAttested,
  readRootState,
  scanChanges,
  sourceHead,
  type CreditcoinRootState,
} from "@/lib/relay/source";

export function attestedWorldIdFor(chainKey: SourceChainKey): Hex | undefined {
  return (chainKey === 3 ? CONTRACTS.attestedWorldIDMainnet : CONTRACTS.attestedWorldIDSepolia).address;
}

/** How far back the other tree is scanned: one log window, about a week of blocks. */
const OTHER_TREE_LOOKBACK = 50_000;

/**
 * Whether `root` belongs to the *other* World ID tree: a World App (Orb) proof opened
 * on the staging profile, or a simulator proof opened on the Orb one. Both are genuine
 * proofs aimed at the wrong registry, and naming the right tree turns a dead end into
 * one click.
 *
 * Creditcoin's other AttestedWorldID instance is asked first (one read); the other
 * source chain is scanned only when that says no. Any failure answers `null`, which
 * leaves the plain not-found answer in place rather than guessing.
 */
export async function findInOtherTree(
  client: PublicClient,
  chainKey: SourceChainKey,
  root: bigint,
): Promise<SourceChainKey | null> {
  const other: SourceChainKey = chainKey === 3 ? 1 : 3;
  try {
    const contract = attestedWorldIdFor(other);
    if (contract) {
      const known = await client.readContract({
        address: contract,
        abi: attestedWorldIdAbi,
        functionName: "isValidRoot",
        args: [root],
      });
      if (known) return other;
    }
    const head = await sourceHead(other);
    const change = await findChangeByPostRoot(other, root, { toBlock: head, maxLookback: OTHER_TREE_LOOKBACK });
    return change ? other : null;
  } catch {
    return null;
  }
}

export type BuiltPlan = {
  plan: RelayPlan;
  state: CreditcoinRootState;
  contract: Hex;
  sourceHead: number | null;
  /** ChainInfo `is_height_attested` for the target update's block; `undefined` when not asked. */
  targetAttested?: boolean;
};

export async function buildRelayPlan(options: {
  client: PublicClient;
  chainKey: SourceChainKey;
  /** The root to make valid on Creditcoin. */
  root: bigint;
  contract?: Hex;
}): Promise<BuiltPlan> {
  const { client, chainKey, root } = options;
  const contract = options.contract ?? attestedWorldIdFor(chainKey);
  if (!contract) throw new Error(`No AttestedWorldID is deployed for chainKey ${chainKey}.`);

  const state = await readRootState(client, contract, chainKey, root);
  if (state.targetKnown) return { plan: { status: "known" }, state, contract, sourceHead: null };

  const head = await sourceHead(chainKey);
  const [targetChange, latestChange] = await Promise.all([
    findChangeByPostRoot(chainKey, root, { toBlock: head }),
    state.latestRoot === null
      ? Promise.resolve<TreeChange | null>(null)
      : findChangeByPostRoot(chainKey, state.latestRoot, { toBlock: head }),
  ]);

  // Inclusive of the tip's own block: a later update can share it.
  const [changes, targetAttested, otherTree] = await Promise.all([
    targetChange && latestChange && targetChange.blockNumber >= latestChange.blockNumber
      ? scanChanges(chainKey, latestChange.blockNumber, targetChange.blockNumber)
      : Promise.resolve([]),
    targetChange ? isHeightAttested(client, chainKey, targetChange.blockNumber) : Promise.resolve(undefined),
    targetChange ? Promise.resolve(null) : findInOtherTree(client, chainKey, root),
  ]);

  const plan = planRelay({
    target: root,
    targetKnown: false,
    latestRoot: state.latestRoot,
    targetChange,
    otherTree,
    latestChange,
    changes,
    attestedTip: state.attestedTip,
    finalityDepth: state.finalityDepth,
    sourceBlockTime: state.sourceBlockTime,
  });
  return { plan, state, contract, sourceHead: head, targetAttested };
}

/**
 * The newest update on the source chain, as the target for a scheduled relay pass:
 * "carry everything up to the head that the finality guard already accepts".
 */
export async function newestFinalRoot(
  chainKey: SourceChainKey,
  state: Pick<CreditcoinRootState, "attestedTip" | "finalityDepth">,
  lookback = 50_000,
): Promise<TreeChange | null> {
  const ceiling = state.attestedTip - state.finalityDepth;
  if (ceiling <= 0) return null;
  const changes = await scanChanges(chainKey, Math.max(0, ceiling - lookback), ceiling);
  return changes.at(-1) ?? null;
}
