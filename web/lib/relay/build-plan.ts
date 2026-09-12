/**
 * Compose the network reads into a relay plan. Server-only.
 *
 * Shared by `/api/relay/plan` (a user's self-relay) and the scheduled relay route,
 * so the operator and any user walk exactly the same chain of updates.
 */

import type { Hex, PublicClient } from "viem";

import type { SourceChainKey } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import { planRelay, type RelayPlan, type TreeChange } from "@/lib/relay/plan";
import {
  findChangeByPostRoot,
  readRootState,
  scanChanges,
  sourceHead,
  type CreditcoinRootState,
} from "@/lib/relay/source";

export function attestedWorldIdFor(chainKey: SourceChainKey): Hex | undefined {
  return (chainKey === 3 ? CONTRACTS.attestedWorldIDMainnet : CONTRACTS.attestedWorldIDSepolia).address;
}

export type BuiltPlan = {
  plan: RelayPlan;
  state: CreditcoinRootState;
  contract: Hex;
  sourceHead: number | null;
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
  const changes =
    targetChange && latestChange && targetChange.blockNumber >= latestChange.blockNumber
      ? await scanChanges(chainKey, latestChange.blockNumber, targetChange.blockNumber)
      : [];

  const plan = planRelay({
    target: root,
    targetKnown: false,
    latestRoot: state.latestRoot,
    targetChange,
    latestChange,
    changes,
    attestedTip: state.attestedTip,
    finalityDepth: state.finalityDepth,
    sourceBlockTime: state.sourceBlockTime,
  });
  return { plan, state, contract, sourceHead: head };
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
