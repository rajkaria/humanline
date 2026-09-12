import { describe, expect, test } from "bun:test";

import { buildReport, RELAY_SLO_SEC } from "@/lib/relay/summary";
import type { RelaySample } from "@/lib/relay/stats";

const NOW = 1_800_000_000;
const GAP = (32 + 42) * 12;

function s(chainKey: number, ageSec: number, e2eSec: number, relayer = "0xop"): RelaySample {
  const relayedAt = NOW - ageSec;
  return {
    chainKey,
    sourceBlock: 1,
    sourceTimestamp: relayedAt - e2eSec,
    relayedAt,
    relayer,
    creditcoinTxHash: `0x${ageSec}`,
  };
}

describe("buildReport", () => {
  test("per-chain and combined numbers from real-shaped samples", () => {
    const report = buildReport(
      [
        { chainKey: 3, samples: [s(3, 3_600, 1_000), s(3, 90_000, 3_000)], pending: [], finalityDepth: 32 },
        { chainKey: 1, samples: [s(1, 600, 950, "0xuser")], pending: [], finalityDepth: 32 },
      ],
      ["0xop"],
      NOW,
    );
    expect(report.sloSec).toBe(RELAY_SLO_SEC);
    expect(report.health.status).toBe("ok");
    expect(report.chains.map((c) => c.samples)).toEqual([2, 1]);
    // The 90 000 s-old sample is outside 24h but inside all-time.
    expect(report.chains[0]!.endToEnd24h.count).toBe(1);
    expect(report.chains[0]!.endToEndAll.max).toBe(3_000);
    expect(report.endToEndAll.count).toBe(3);
    expect(report.relayers).toEqual([
      { relayer: "0xop", roots: 2, operator: true },
      { relayer: "0xuser", roots: 1, operator: false },
    ]);
    expect(report.recent[0]!.relayedAt).toBe(NOW - 600);
    expect(report.recent[0]!.relayDelaySec).toBe(950 - GAP);
  });

  test("a pending root past the SLO makes the report late and costs uptime", () => {
    const report = buildReport(
      [
        {
          chainKey: 1,
          samples: [],
          pending: [{ chainKey: 1, sourceBlock: 9, sourceTimestamp: NOW - GAP - RELAY_SLO_SEC - 120 }],
          finalityDepth: 32,
        },
      ],
      [],
      NOW,
    );
    expect(report.health.status).toBe("late");
    expect(report.uptime24h.overdueSec).toBe(120);
    expect(report.chains[0]!.pending).toBe(1);
  });

  test("no samples at all is an empty but valid report", () => {
    const report = buildReport([{ chainKey: 1, samples: [], pending: [], finalityDepth: 32 }], [], NOW);
    expect(report.endToEndAll.count).toBe(0);
    expect(report.chains[0]!.lastRelayAt).toBeNull();
    expect(report.health.lastRelayAgeSec).toBeNull();
  });
});
