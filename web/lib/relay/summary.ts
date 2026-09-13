/**
 * Assemble the public relay report from per-chain tracks. Pure: `collect.ts` does
 * the reading, `stats.ts` the maths, and this decides the shape `/relay`,
 * `/api/relay/stats` and the watchdog share.
 */

import {
  assessHealth,
  distribution,
  relayableAt,
  relayerShares,
  uptime,
  type Distribution,
  type Health,
  type PendingRoot,
  type RelayerShare,
  type RelaySample,
  type Uptime,
} from "@/lib/relay/stats";

export const RELAY_SLO_SEC = 600;
export const RELAY_STALL_SEC = 3_600;
/**
 * When the 5-minute relay went live (commit 1ffa5aa). Roots before it were carried by
 * hand, hours late; the "always on" block measures only the relay as it runs today,
 * while the all-time numbers stay published next to it.
 */
export const ALWAYS_ON_SINCE = Date.parse("2026-09-12T20:51:52Z") / 1000;
const DAY = 86_400;

export type TrackInput = {
  chainKey: number;
  samples: RelaySample[];
  pending: PendingRoot[];
  finalityDepth: number;
};

export type ChainReport = {
  chainKey: number;
  samples: number;
  pending: number;
  lastRelayAt: number | null;
  endToEnd24h: Distribution;
  endToEndAll: Distribution;
  relayDelayAll: Distribution;
  uptime24h: Uptime;
  uptime7d: Uptime;
};

/** The relay as it runs today: everything since `ALWAYS_ON_SINCE`, across both chains. */
export type AlwaysOn = {
  since: number;
  endToEnd: Distribution;
  relayDelay: Distribution;
  uptime: Uptime;
};

export type RelayReport = {
  generatedAt: number;
  sloSec: number;
  health: Health;
  chains: ChainReport[];
  alwaysOn: AlwaysOn;
  /** Across both chains. */
  endToEndAll: Distribution;
  relayDelayAll: Distribution;
  uptime24h: Uptime;
  relayers: RelayerShare[];
  /** Newest first, for the latency strip on /relay. */
  recent: Array<RelaySample & { endToEndSec: number; relayDelaySec: number }>;
};

function timingFor(depth: number) {
  return { finalityDepth: depth, blockTime: 12, attestationLagBlocks: 42 };
}

function lastRelay(samples: readonly RelaySample[]): number | null {
  return samples.length === 0 ? null : Math.max(...samples.map((s) => s.relayedAt));
}

export function buildReport(
  tracks: readonly TrackInput[],
  operators: readonly string[],
  now: number,
  alwaysOnSince: number = ALWAYS_ON_SINCE,
): RelayReport {
  const chains: ChainReport[] = tracks.map((t) => {
    const timing = timingFor(t.finalityDepth);
    const e2e = (s: RelaySample) => s.relayedAt - s.sourceTimestamp;
    const recent = t.samples.filter((s) => s.relayedAt >= now - DAY);
    return {
      chainKey: t.chainKey,
      samples: t.samples.length,
      pending: t.pending.length,
      lastRelayAt: lastRelay(t.samples),
      endToEnd24h: distribution(recent.map(e2e)),
      endToEndAll: distribution(t.samples.map(e2e)),
      relayDelayAll: distribution(t.samples.map((s) => Math.max(0, s.relayedAt - relayableAt(s.sourceTimestamp, timing)))),
      uptime24h: uptime(t.samples, t.pending, { now, windowSec: DAY, sloSec: RELAY_SLO_SEC, timing }),
      uptime7d: uptime(t.samples, t.pending, { now, windowSec: 7 * DAY, sloSec: RELAY_SLO_SEC, timing }),
    };
  });

  const allSamples = tracks.flatMap((t) => t.samples.map((s) => ({ s, depth: t.finalityDepth })));
  const allPending = tracks.flatMap((t) => t.pending);
  const depth = tracks[0]?.finalityDepth ?? 32;

  const health = assessHealth({
    now,
    pending: allPending,
    lastRelayAt: lastRelay(allSamples.map((x) => x.s)),
    sloSec: RELAY_SLO_SEC,
    stallSec: RELAY_STALL_SEC,
    timing: timingFor(depth),
  });

  // Uptime across chains: a moment is down if either chain has an overdue root.
  const combined = uptime(
    allSamples.map((x) => x.s),
    allPending,
    { now, windowSec: DAY, sloSec: RELAY_SLO_SEC, timing: timingFor(depth) },
  );

  const since = Math.min(alwaysOnSince, now);
  const live = allSamples.filter((x) => x.s.relayedAt >= since);
  const delayOf = (x: { s: RelaySample; depth: number }) =>
    Math.max(0, x.s.relayedAt - relayableAt(x.s.sourceTimestamp, timingFor(x.depth)));

  return {
    generatedAt: now,
    sloSec: RELAY_SLO_SEC,
    health,
    chains,
    alwaysOn: {
      since,
      endToEnd: distribution(live.map((x) => x.s.relayedAt - x.s.sourceTimestamp)),
      relayDelay: distribution(live.map(delayOf)),
      uptime: uptime(
        allSamples.map((x) => x.s),
        allPending,
        { now, windowSec: now - since, sloSec: RELAY_SLO_SEC, timing: timingFor(depth) },
      ),
    },
    endToEndAll: distribution(allSamples.map((x) => x.s.relayedAt - x.s.sourceTimestamp)),
    relayDelayAll: distribution(allSamples.map(delayOf)),
    uptime24h: combined,
    relayers: relayerShares(allSamples.map((x) => x.s), operators),
    recent: allSamples
      .map(({ s, depth: d }) => ({
        ...s,
        endToEndSec: s.relayedAt - s.sourceTimestamp,
        relayDelaySec: Math.max(0, s.relayedAt - relayableAt(s.sourceTimestamp, timingFor(d))),
      }))
      .sort((a, b) => b.relayedAt - a.relayedAt)
      .slice(0, 60),
  };
}
