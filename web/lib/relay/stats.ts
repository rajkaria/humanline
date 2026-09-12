/**
 * Relay liveness, measured: latency distribution, uptime against an SLO, who
 * relayed, and a watchdog verdict.
 *
 * Pure. `/api/relay/stats` feeds it samples read from chain (RootRelayed on CC3,
 * source block timestamps on Ethereum), so every number on `/relay` can be
 * recomputed by anyone with an RPC.
 *
 * Two latencies matter and they are different:
 *   - end to end: source block timestamp → Creditcoin inclusion. What a user feels.
 *   - relay delay: when the root *could first* be relayed → when it was. What the
 *     relayer controls. A root cannot be relayed before Creditcoin's attestors are
 *     `FINALITY_DEPTH` blocks past it, so that part of the wait belongs to the
 *     protocol, not to Humanline.
 */

export type RelaySample = {
  chainKey: number;
  sourceBlock: number;
  /** Unix seconds of the source block. */
  sourceTimestamp: number;
  /** Unix seconds of the Creditcoin block that included the relay. */
  relayedAt: number;
  relayer: string;
  creditcoinTxHash: string;
};

export type Distribution = {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
};

/** Nearest-rank percentile over an ascending array. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, p50: null, p95: null, max: null, mean: null };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
    mean: Math.round(sum / sorted.length),
  };
}

export type Timing = {
  /** `AttestedWorldID.FINALITY_DEPTH()`. */
  finalityDepth: number;
  /** Seconds per source block. */
  blockTime: number;
  /** Typical blocks between a source head and Creditcoin's attested tip (measured ~42). */
  attestationLagBlocks: number;
};

export const DEFAULT_TIMING: Timing = { finalityDepth: 32, blockTime: 12, attestationLagBlocks: 42 };

/** Earliest moment the finality guard could have accepted this root, estimated. */
export function relayableAt(sourceTimestamp: number, timing: Timing = DEFAULT_TIMING): number {
  return sourceTimestamp + (timing.finalityDepth + timing.attestationLagBlocks) * timing.blockTime;
}

/** Seconds past the SLO this sample waited, or 0. */
export function overdueBy(
  sample: Pick<RelaySample, "sourceTimestamp" | "relayedAt">,
  sloSec: number,
  timing: Timing = DEFAULT_TIMING,
): number {
  return Math.max(0, sample.relayedAt - (relayableAt(sample.sourceTimestamp, timing) + sloSec));
}

/** Total length of the union of `[start, end)` intervals, clipped to `[from, to)`. */
export function unionLength(intervals: ReadonlyArray<[number, number]>, from: number, to: number): number {
  const clipped = intervals
    .map(([s, e]): [number, number] => [Math.max(from, s), Math.min(to, e)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart: number | null = null;
  let curEnd = 0;
  for (const [s, e] of clipped) {
    if (curStart === null) {
      curStart = s;
      curEnd = e;
    } else if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  if (curStart !== null) total += curEnd - curStart;
  return total;
}

export type PendingRoot = { chainKey: number; sourceBlock: number; sourceTimestamp: number };

export type Uptime = {
  windowSec: number;
  sloSec: number;
  /** 0..1: share of the window in which no relayable root was waiting longer than the SLO. */
  ratio: number;
  overdueSec: number;
};

/**
 * A moment is "down" when some root has been relayable for longer than the SLO and
 * still is not on Creditcoin. Each late root contributes the interval from its SLO
 * deadline to when it landed (or to `now` if it is still pending).
 */
export function uptime(
  samples: readonly RelaySample[],
  pending: readonly PendingRoot[],
  { now, windowSec = 86_400, sloSec = 600, timing = DEFAULT_TIMING }: {
    now: number;
    windowSec?: number;
    sloSec?: number;
    timing?: Timing;
  },
): Uptime {
  const from = now - windowSec;
  const intervals: Array<[number, number]> = [];
  for (const s of samples) {
    const deadline = relayableAt(s.sourceTimestamp, timing) + sloSec;
    if (s.relayedAt > deadline) intervals.push([deadline, s.relayedAt]);
  }
  for (const p of pending) {
    const deadline = relayableAt(p.sourceTimestamp, timing) + sloSec;
    if (now > deadline) intervals.push([deadline, now]);
  }
  const overdueSec = unionLength(intervals, from, now);
  return { windowSec, sloSec, ratio: windowSec > 0 ? 1 - overdueSec / windowSec : 1, overdueSec };
}

export type RelayerShare = { relayer: string; roots: number; operator: boolean };

export function relayerShares(samples: readonly RelaySample[], operators: readonly string[]): RelayerShare[] {
  const ops = new Set(operators.map((o) => o.toLowerCase()));
  const counts = new Map<string, number>();
  for (const s of samples) counts.set(s.relayer.toLowerCase(), (counts.get(s.relayer.toLowerCase()) ?? 0) + 1);
  return [...counts.entries()]
    .map(([relayer, roots]) => ({ relayer, roots, operator: ops.has(relayer) }))
    .sort((a, b) => b.roots - a.roots);
}

export type HealthStatus = "ok" | "late" | "stalled";

export type Health = {
  status: HealthStatus;
  /** The oldest relayable-but-unrelayed root has been waiting this long past relayable, in seconds. */
  waitingSec: number;
  lastRelayAgeSec: number | null;
  reason: string;
};

/**
 * The watchdog verdict.
 *  - ok: nothing relayable is waiting past the SLO.
 *  - late: something is past the SLO (a user would see "syncing" for too long).
 *  - stalled: something has waited more than `stallSec` — the scheduled relay is not running.
 * World's tree changing rarely is not an outage: with nothing pending the relay is ok
 * however long ago the last root landed.
 */
export function assessHealth({
  now,
  pending,
  lastRelayAt,
  sloSec = 600,
  stallSec = 3_600,
  timing = DEFAULT_TIMING,
}: {
  now: number;
  pending: readonly PendingRoot[];
  lastRelayAt: number | null;
  sloSec?: number;
  stallSec?: number;
  timing?: Timing;
}): Health {
  const lastRelayAgeSec = lastRelayAt === null ? null : Math.max(0, now - lastRelayAt);
  const waits = pending.map((p) => Math.max(0, now - relayableAt(p.sourceTimestamp, timing)));
  const waitingSec = waits.length === 0 ? 0 : Math.max(...waits);
  if (waitingSec > stallSec) {
    return {
      status: "stalled",
      waitingSec,
      lastRelayAgeSec,
      reason: `A relayable World ID root has waited ${Math.round(waitingSec / 60)} min; the scheduled relay is not running.`,
    };
  }
  if (waitingSec > sloSec) {
    return {
      status: "late",
      waitingSec,
      lastRelayAgeSec,
      reason: `A relayable World ID root has waited ${Math.round(waitingSec / 60)} min, past the ${Math.round(sloSec / 60)}-minute target.`,
    };
  }
  return {
    status: "ok",
    waitingSec,
    lastRelayAgeSec,
    reason: pending.length === 0 ? "Every relayable root is on Creditcoin." : "Roots are within the relay target.",
  };
}
