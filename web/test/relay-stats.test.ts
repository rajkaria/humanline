import { describe, expect, test } from "bun:test";

import {
  assessHealth,
  DEFAULT_TIMING,
  distribution,
  overdueBy,
  percentile,
  relayableAt,
  relayerShares,
  unionLength,
  uptime,
  type RelaySample,
} from "@/lib/relay/stats";

const GAP = (DEFAULT_TIMING.finalityDepth + DEFAULT_TIMING.attestationLagBlocks) * DEFAULT_TIMING.blockTime; // 888s

function sample(sourceTimestamp: number, relayedAt: number, relayer = "0xop"): RelaySample {
  return {
    chainKey: 1,
    sourceBlock: sourceTimestamp,
    sourceTimestamp,
    relayedAt,
    relayer,
    creditcoinTxHash: `0x${sourceTimestamp}`,
  };
}

describe("percentile / distribution", () => {
  test("nearest rank", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile([], 50)).toBeNull();
  });

  test("distribution sorts, ignores non-finite values and rounds the mean", () => {
    expect(distribution([30, 10, Number.NaN, 20])).toEqual({ count: 3, p50: 20, p95: 30, max: 30, mean: 20 });
    expect(distribution([]).count).toBe(0);
  });
});

describe("relayable time", () => {
  test("finality depth plus attestation lag, in source blocks", () => {
    expect(relayableAt(1_000)).toBe(1_000 + GAP);
  });

  test("overdue only counts time past relayable + SLO", () => {
    expect(overdueBy(sample(0, GAP + 600), 600)).toBe(0);
    expect(overdueBy(sample(0, GAP + 900), 600)).toBe(300);
  });
});

describe("unionLength", () => {
  test("merges overlaps and clips to the window", () => {
    expect(unionLength([[0, 10], [5, 15], [20, 30]], 0, 100)).toBe(25);
    expect(unionLength([[-50, 10]], 0, 100)).toBe(10);
    expect(unionLength([[90, 200]], 0, 100)).toBe(10);
    expect(unionLength([], 0, 100)).toBe(0);
  });
});

describe("uptime", () => {
  const now = 100_000;

  test("every root on time → 100%", () => {
    const u = uptime([sample(now - 5_000, now - 5_000 + GAP + 60)], [], { now });
    expect(u.ratio).toBe(1);
  });

  test("a late root costs the time between its deadline and its landing", () => {
    const s = sample(now - 10_000, now - 10_000 + GAP + 600 + 864);
    const u = uptime([s], [], { now, windowSec: 86_400, sloSec: 600 });
    expect(u.overdueSec).toBe(864);
    expect(u.ratio).toBeCloseTo(0.99, 5);
  });

  test("a root still pending counts up to now", () => {
    const u = uptime([], [{ chainKey: 1, sourceBlock: 1, sourceTimestamp: now - GAP - 600 - 100 }], { now });
    expect(u.overdueSec).toBe(100);
  });

  test("two late roots overlapping are not double counted", () => {
    const a = sample(now - 5_000, now - 5_000 + GAP + 600 + 1_000);
    const b = sample(now - 4_800, now - 5_000 + GAP + 600 + 1_000);
    expect(uptime([a, b], [], { now }).overdueSec).toBe(1_000);
  });
});

describe("relayerShares", () => {
  test("counts roots per relayer and marks the operator", () => {
    const shares = relayerShares(
      [sample(1, 2, "0xOP"), sample(3, 4, "0xop"), sample(5, 6, "0xuser")],
      ["0xOp"],
    );
    expect(shares).toEqual([
      { relayer: "0xop", roots: 2, operator: true },
      { relayer: "0xuser", roots: 1, operator: false },
    ]);
  });
});

describe("assessHealth", () => {
  const now = 50_000;

  test("nothing pending is healthy however old the last relay is", () => {
    expect(assessHealth({ now, pending: [], lastRelayAt: now - 20_000 }).status).toBe("ok");
  });

  test("pending but still inside the SLO is ok", () => {
    const h = assessHealth({ now, pending: [{ chainKey: 1, sourceBlock: 1, sourceTimestamp: now - GAP - 300 }], lastRelayAt: null });
    expect(h.status).toBe("ok");
    expect(h.waitingSec).toBe(300);
  });

  test("past the SLO is late", () => {
    const h = assessHealth({ now, pending: [{ chainKey: 1, sourceBlock: 1, sourceTimestamp: now - GAP - 900 }], lastRelayAt: now - 4_000 });
    expect(h.status).toBe("late");
    expect(h.lastRelayAgeSec).toBe(4_000);
  });

  test("past the stall threshold is stalled", () => {
    const h = assessHealth({ now, pending: [{ chainKey: 1, sourceBlock: 1, sourceTimestamp: now - GAP - 4_000 }], lastRelayAt: null });
    expect(h.status).toBe("stalled");
    expect(h.reason).toMatch(/not running/);
  });
});
