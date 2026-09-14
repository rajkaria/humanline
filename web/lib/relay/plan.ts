/**
 * Self-relay planning: which World ID updates have to reach Creditcoin, in which
 * order, and in how many transactions, before a given proof root is usable.
 *
 * World App issues a proof against the identity tree's newest root. Creditcoin
 * only knows the roots someone has carried across, and `AttestedWorldID` accepts
 * a root only when its `preRoot` is already the tip. So "relay my root" really
 * means "relay every tree update between the tip Creditcoin knows and my root,
 * oldest first", and that chain is what this module works out.
 *
 * Everything here is pure: the network reads happen in `lib/relay/source.ts` and
 * the API route, so the rules that decide what a user's wallet will be asked to
 * sign are unit-tested without an RPC.
 */

import type { SourceChainKey } from "@/lib/chains";

/** One source-chain transaction that emitted a genuine `TreeChanged`. */
export type TreeChange = {
  txHash: `0x${string}`;
  blockNumber: number;
  txIndex: number;
  logIndex: number;
  preRoot: bigint;
  postRoot: bigint;
  /** 0 = insertion, 1 = deletion (World's `TreeChange` enum). */
  kind: number;
};

/** Mirrors `AttestedWorldID.MAX_BATCH`. */
export const MAX_BATCH = 10;
/**
 * Widest block span one `executeBatch` may cover. The members share one continuity
 * proof, and the proof builder serves batches up to this span; the worker uses the
 * same bound (`worker/src/config.ts` `BATCH_MAX_SPAN`).
 */
export const MAX_SPAN = 1_000;
/** Attestcoin attests source chains in steps of this many blocks. */
export const ATTESTATION_STEP = 10;

export type PlanInput = {
  /** The Merkle root inside the user's proof. */
  target: bigint;
  /** `isValidRoot(target)` on Creditcoin. */
  targetKnown: boolean;
  /** `latestRoot()` on Creditcoin, or `null` before the first root was ever relayed. */
  latestRoot: bigint | null;
  /** The source tx whose postRoot is the target, when the scan found one. */
  targetChange: TreeChange | null;
  /**
   * When the target is missing here, the other World ID tree that does have it: a World
   * App (Orb) proof opened on the staging profile, or a simulator proof on the Orb one.
   */
  otherTree?: SourceChainKey | null;
  /** The source tx whose postRoot is Creditcoin's latest root, when found. */
  latestChange: TreeChange | null;
  /** Every TreeChanged tx strictly after `latestChange` up to and including the target, any order. */
  changes: TreeChange[];
  /** ChainInfo attested tip for the source chain. */
  attestedTip: number;
  /** `AttestedWorldID.FINALITY_DEPTH()`. */
  finalityDepth: number;
  /** `AttestedWorldID.SOURCE_BLOCK_TIME()` in seconds. */
  sourceBlockTime: number;
  maxBatch?: number;
  maxSpan?: number;
};

export type Batch = {
  changes: TreeChange[];
  fromBlock: number;
  toBlock: number;
  /** Whether the finality guard accepts every member right now. */
  final: boolean;
};

type Shared = {
  /** The ordered updates to relay, oldest first. */
  chain: TreeChange[];
  batches: Batch[];
  /** Source height the attested tip has to reach before the last batch is accepted. */
  needHeight: number;
  attestedTip: number;
  /** Blocks the attested tip still has to advance (0 when ready). */
  blocksToGo: number;
  /** Rough seconds until `blocksToGo` is covered, rounded up to whole attestation steps. */
  etaSeconds: number;
};

export type RelayPlan =
  | { status: "known" }
  | { status: "not-found"; reason: string }
  | { status: "wrong-tree"; chainKey: SourceChainKey; reason: string }
  | { status: "stale"; reason: string }
  | { status: "gap"; reason: string }
  | ({ status: "waiting" } & Shared)
  | ({ status: "ready" } & Shared);

export type RelayPlanStatus = RelayPlan["status"];

/** Source order: block, then position of the log inside the block. */
export function compareChanges(a: TreeChange, b: TreeChange): number {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

/**
 * Walks `preRoot -> postRoot` links from `from` until `to`, in source order.
 *
 * Returns `null` when the links break before reaching `to`: an update missing from
 * the scan, or a target that is not a descendant of `from` at all. Never skips a
 * link, because the contract would refuse the next one with `UnknownPreRoot`.
 */
export function buildChain(
  changes: readonly TreeChange[],
  from: bigint | null,
  to: bigint,
): TreeChange[] | null {
  const ordered = [...changes].sort(compareChanges);

  // Before the first root was ever relayed, the contract bootstraps from any update,
  // so the target's own transaction is the whole chain.
  if (from === null) {
    const own = ordered.find((c) => c.postRoot === to);
    return own ? [own] : null;
  }

  const chain: TreeChange[] = [];
  let root = from;
  let cursor = 0;
  // `cursor` only moves forward, so the walk ends after at most `ordered.length` steps.
  while (root !== to) {
    let next = -1;
    for (let i = cursor; i < ordered.length; i += 1) {
      if (ordered[i]!.preRoot === root) {
        next = i;
        break;
      }
    }
    if (next < 0) return null;
    const change = ordered[next]!;
    chain.push(change);
    root = change.postRoot;
    cursor = next + 1;
  }
  return chain;
}

/**
 * Splits an ordered chain into `executeBatch` calls: consecutive, at most `maxBatch`
 * members, and a block span no wider than `maxSpan`. Same grouping rule as the
 * worker's `groupIntoBatches`, so a self-relay and the operator never disagree.
 */
export function groupBatches(
  chain: readonly TreeChange[],
  { maxBatch = MAX_BATCH, maxSpan = MAX_SPAN }: { maxBatch?: number; maxSpan?: number } = {},
): TreeChange[][] {
  if (maxBatch <= 0) throw new Error("maxBatch must be positive");
  const batches: TreeChange[][] = [];
  let current: TreeChange[] = [];
  for (const change of chain) {
    const first = current[0];
    if (first && (current.length >= maxBatch || change.blockNumber - first.blockNumber > maxSpan)) {
      batches.push(current);
      current = [];
    }
    current.push(change);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Seconds until the attested tip covers `blocksToGo`, in whole attestation steps. */
export function etaFor(blocksToGo: number, sourceBlockTime: number): number {
  if (blocksToGo <= 0) return 0;
  const steps = Math.ceil(blocksToGo / ATTESTATION_STEP);
  return steps * ATTESTATION_STEP * sourceBlockTime;
}

export function planRelay(input: PlanInput): RelayPlan {
  if (input.targetKnown) return { status: "known" };

  const target = input.targetChange;
  if (!target || target.postRoot !== input.target) {
    if (input.otherTree === 3) {
      return {
        status: "wrong-tree",
        chainKey: 3,
        reason:
          "This proof comes from World's Orb tree (World App), but this profile verifies against the staging tree on Ethereum Sepolia. Switch to the Orb profile: the same proof works there, no need to scan again.",
      };
    }
    if (input.otherTree === 1) {
      return {
        status: "wrong-tree",
        chainKey: 1,
        reason:
          "This proof comes from World's staging tree (the World ID Simulator), but this profile verifies against the Orb tree on Ethereum mainnet. Switch to the staging profile: the same proof works there, no need to scan again.",
      };
    }
    return {
      status: "not-found",
      reason:
        "No World ID update with this root was found on the source chain. The proof may come from the other World ID environment (staging vs production), or from an update older than the scan window.",
    };
  }

  if (input.latestRoot !== null) {
    if (!input.latestChange) {
      return {
        status: "gap",
        reason:
          "Creditcoin's newest root could not be located on the source chain, so the updates in between cannot be ordered. The scheduled relayer will close the gap.",
      };
    }
    if (compareChanges(target, input.latestChange) <= 0) {
      return {
        status: "stale",
        reason:
          "This proof was made against a root older than the one Creditcoin already follows, and that root has expired or was never carried across. Generate a fresh proof: it will use the newest root.",
      };
    }
  }

  const latest = input.latestChange;
  const scoped = input.changes.filter(
    (c) => (!latest || compareChanges(c, latest) > 0) && compareChanges(c, target) <= 0,
  );
  if (!scoped.some((c) => c.txHash.toLowerCase() === target.txHash.toLowerCase())) scoped.push(target);
  const chain = buildChain(scoped, input.latestRoot, input.target);
  if (!chain || chain.length === 0) {
    return {
      status: "gap",
      reason:
        "The World ID updates between Creditcoin's newest root and this proof do not link up in the scanned range, so they cannot be relayed in order yet.",
    };
  }

  const tip = input.attestedTip;
  const depth = input.finalityDepth;
  const batches: Batch[] = groupBatches(chain, input).map((changes) => {
    const fromBlock = changes[0]!.blockNumber;
    const toBlock = changes[changes.length - 1]!.blockNumber;
    return { changes, fromBlock, toBlock, final: tip >= toBlock + depth };
  });

  const needHeight = chain[chain.length - 1]!.blockNumber + depth;
  const blocksToGo = Math.max(0, needHeight - tip);
  const shared: Shared = {
    chain,
    batches,
    needHeight,
    attestedTip: tip,
    blocksToGo,
    etaSeconds: etaFor(blocksToGo, input.sourceBlockTime),
  };
  return blocksToGo === 0 ? { status: "ready", ...shared } : { status: "waiting", ...shared };
}

// ---------------------------------------------------------------------------
// Wire format: bigints travel as decimal strings.
// ---------------------------------------------------------------------------

export type TreeChangeJson = Omit<TreeChange, "preRoot" | "postRoot"> & {
  preRoot: string;
  postRoot: string;
};

export type BatchJson = Omit<Batch, "changes"> & { changes: TreeChangeJson[] };

export type RelayPlanJson =
  | { status: "known" }
  | { status: "not-found" | "stale" | "gap"; reason: string }
  | { status: "wrong-tree"; chainKey: SourceChainKey; reason: string }
  | (Omit<Shared, "chain" | "batches"> & {
      status: "waiting" | "ready";
      chain: TreeChangeJson[];
      batches: BatchJson[];
    });

export function changeToJson(change: TreeChange): TreeChangeJson {
  return { ...change, preRoot: change.preRoot.toString(), postRoot: change.postRoot.toString() };
}

export function changeFromJson(change: TreeChangeJson): TreeChange {
  return { ...change, preRoot: BigInt(change.preRoot), postRoot: BigInt(change.postRoot) };
}

export function planToJson(plan: RelayPlan): RelayPlanJson {
  if (plan.status === "known") return plan;
  if (
    plan.status === "not-found" ||
    plan.status === "wrong-tree" ||
    plan.status === "stale" ||
    plan.status === "gap"
  ) {
    return plan;
  }
  return {
    ...plan,
    chain: plan.chain.map(changeToJson),
    batches: plan.batches.map((b) => ({ ...b, changes: b.changes.map(changeToJson) })),
  };
}

export function planFromJson(json: RelayPlanJson): RelayPlan {
  if (json.status === "known") return json;
  if ("reason" in json) return json as RelayPlan;
  return {
    ...json,
    chain: json.chain.map(changeFromJson),
    batches: json.batches.map((b) => ({ ...b, changes: b.changes.map(changeFromJson) })),
  };
}
