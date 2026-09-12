// Batching, cursor derivation, finality ceiling and the retry policy. No network.
import { describe, expect, test } from "bun:test";
import {
  classifyRevert,
  deriveCursor,
  executeWithRetry,
  finalScanCeiling,
  groupIntoBatches,
  nextRetryAction,
  settledThrough,
  shouldRetryWithFreshProof,
  type RetryAction,
  type RevertClass,
} from "../src/relay";
import { BATCH_MAX_SIZE, BATCH_MAX_SPAN } from "../src/config";

const tx = (blockNumber: number) => ({ blockNumber, txHash: `0x${blockNumber}` });

describe("groupIntoBatches", () => {
  test("empty input yields no batches", () => {
    expect(groupIntoBatches([])).toEqual([]);
  });

  test("keeps a run within the span and size limits in one batch", () => {
    const items = [tx(100), tx(400), tx(1100)];
    expect(groupIntoBatches(items, { maxSpan: 1000, maxSize: 10 })).toEqual([items]);
  });

  test("splits when the span would exceed maxSpan", () => {
    const batches = groupIntoBatches([tx(100), tx(900), tx(1101)], { maxSpan: 1000, maxSize: 10 });
    expect(batches.map((b) => b.map((t) => t.blockNumber))).toEqual([[100, 900], [1101]]);
  });

  test("span is measured from the first member, not the previous one", () => {
    // 0, 600, 1200: 1200-0 > 1000 so it splits even though each step is only 600.
    const batches = groupIntoBatches([tx(0), tx(600), tx(1200)], { maxSpan: 1000, maxSize: 10 });
    expect(batches.map((b) => b.map((t) => t.blockNumber))).toEqual([[0, 600], [1200]]);
  });

  test("splits at maxSize even when every block is identical", () => {
    const items = Array.from({ length: 23 }, () => tx(500));
    const batches = groupIntoBatches(items, { maxSpan: 1000, maxSize: 10 });
    expect(batches.map((b) => b.length)).toEqual([10, 10, 3]);
  });

  test("defaults match the spec: span 1000, size 10", () => {
    expect(BATCH_MAX_SPAN).toBe(1000);
    expect(BATCH_MAX_SIZE).toBe(10);
    const items = [tx(0), tx(1000), tx(1001)];
    const batches = groupIntoBatches(items);
    expect(batches.map((b) => b.map((t) => t.blockNumber))).toEqual([[0, 1000], [1001]]);
  });

  test("never reorders and never drops a transaction", () => {
    const items = [tx(5), tx(2000), tx(2001), tx(9000)];
    const flat = groupIntoBatches(items).flat();
    expect(flat).toEqual(items);
  });

  test("rejects a non-positive maxSize", () => {
    expect(() => groupIntoBatches([tx(1)], { maxSize: 0 })).toThrow("maxSize must be positive");
  });
});

describe("deriveCursor", () => {
  test("takes the maximum of every known lower bound", () => {
    expect(deriveCursor({ storeCursor: 100, lastRelayedBlock: 250, fromFlag: 50 })).toBe(251);
    expect(deriveCursor({ storeCursor: 900, lastRelayedBlock: 250, fromFlag: 50 })).toBe(900);
    expect(deriveCursor({ storeCursor: 100, lastRelayedBlock: 250, fromFlag: 5000 })).toBe(5000);
  });

  test("on-chain state alone is enough (fresh worker / CI runner)", () => {
    expect(deriveCursor({ lastRelayedBlock: 11687163 })).toBe(11687164);
  });

  test("falls back only when nothing is known", () => {
    expect(deriveCursor({ fallback: 12345 })).toBe(12345);
    expect(deriveCursor({})).toBe(0);
  });

  test("the fallback never competes with real state", () => {
    expect(deriveCursor({ storeCursor: 10, fallback: 9_999_999 })).toBe(10);
  });

  test("a zero cursor is respected rather than treated as absent", () => {
    expect(deriveCursor({ storeCursor: 0, fallback: 500 })).toBe(0);
  });
});

describe("finalScanCeiling", () => {
  test("never scans past what the finality guard could accept", () => {
    expect(finalScanCeiling(11687540, 11687500, 32)).toBe(11687468);
  });

  test("clamps to the head when attestation is ahead of the chain tip", () => {
    expect(finalScanCeiling(100, 1000, 32)).toBe(100);
  });
});

describe("classifyRevert", () => {
  const cases: Array<[string, RevertClass]> = [
    ["execution reverted: Query already processed", "already-processed"],
    ["NotFinal(25959000, 25959565)", "transient"],
    ["ThinQuorum(1, 3)", "transient"],
    ["UnknownPreRoot(123)", "transient"],
    ["execution reverted: Proof of inclusion verification failed", "stale-proof"],
    ["continuity proof rejected", "stale-proof"],
    ["WrongSourceChain(1, 3)", "permanent"],
    ["SourceTxReverted()", "permanent"],
    ["NotIdentityManager(0xdead)", "permanent"],
    ["NoTreeChange()", "permanent"],
    ["AmbiguousTreeChange(2)", "permanent"],
    ["CalldataLogMismatch()", "permanent"],
    ["CannotOverwriteRoot()", "permanent"],
    ["nonce too low", "unknown"],
  ];
  for (const [reason, expected] of cases) {
    test(`${reason} → ${expected}`, () => {
      expect(classifyRevert(reason)).toBe(expected);
    });
  }

  test("only stale proofs and unknown reverts justify a refetch", () => {
    expect(shouldRetryWithFreshProof("stale-proof")).toBe(true);
    expect(shouldRetryWithFreshProof("unknown")).toBe(true);
    expect(shouldRetryWithFreshProof("permanent")).toBe(false);
    expect(shouldRetryWithFreshProof("transient")).toBe(false);
    expect(shouldRetryWithFreshProof("already-processed")).toBe(false);
  });
});

describe("nextRetryAction", () => {
  const table: Array<[RevertClass, number, RetryAction]> = [
    ["already-processed", 0, "mark-already"],
    ["transient", 0, "mark-pending"],
    ["stale-proof", 0, "refetch-retry"],
    ["stale-proof", 1, "mark-failed"],
    ["unknown", 0, "refetch-retry"],
    ["unknown", 1, "mark-failed"],
    ["permanent", 0, "mark-failed"],
  ];
  for (const [cls, attempt, expected] of table) {
    test(`${cls} @ attempt ${attempt} → ${expected}`, () => {
      expect(nextRetryAction(cls, attempt)).toBe(expected);
    });
  }
});

describe("executeWithRetry (mocked submission)", () => {
  const boom = (msg: string) => () => {
    throw new Error(msg);
  };

  test("returns success on the first try without refetching", async () => {
    let refetches = 0;
    const res = await executeWithRetry("b0", {
      send: async () => "ok",
      refetch: async () => {
        refetches += 1;
        return "b1";
      },
    });
    expect(res).toEqual({ kind: "success", result: "ok", attempts: 1 });
    expect(refetches).toBe(0);
  });

  test("a stale proof is refetched once and the retry can succeed", async () => {
    const sent: string[] = [];
    let calls = 0;
    const res = await executeWithRetry("stale", {
      send: async (b) => {
        sent.push(b);
        calls += 1;
        if (calls === 1) boom("execution reverted: Proof of inclusion verification failed")();
        return "ok";
      },
      refetch: async () => "fresh",
    });
    expect(res.kind).toBe("success");
    expect(sent).toEqual(["stale", "fresh"]);
    expect(res.attempts).toBe(2);
  });

  test("a second stale revert gives up rather than looping", async () => {
    let refetches = 0;
    const res = await executeWithRetry("stale", {
      send: async () => boom("execution reverted: Proof of inclusion verification failed")(),
      refetch: async () => {
        refetches += 1;
        return "fresh";
      },
    });
    expect(res.kind).toBe("failed");
    expect(refetches).toBe(1);
    expect(res.attempts).toBe(2);
  });

  test("already-processed is a success path, not a failure", async () => {
    const res = await executeWithRetry("b", {
      send: async () => boom("execution reverted: Query already processed")(),
      refetch: async () => "never",
    });
    expect(res.kind).toBe("already");
  });

  test("transient reverts stay pending and do not refetch", async () => {
    let refetches = 0;
    const res = await executeWithRetry("b", {
      send: async () => boom("NotFinal(1, 2)")(),
      refetch: async () => {
        refetches += 1;
        return "never";
      },
    });
    expect(res.kind).toBe("pending");
    expect(refetches).toBe(0);
  });

  test("permanent reverts fail immediately", async () => {
    let refetches = 0;
    const res = await executeWithRetry("b", {
      send: async () => boom("CalldataLogMismatch()")(),
      refetch: async () => {
        refetches += 1;
        return "never";
      },
    });
    expect(res.kind).toBe("failed");
    expect(refetches).toBe(0);
  });

  test("reports every revert to the caller for logging", async () => {
    const seen: Array<[string, RevertClass, RetryAction]> = [];
    await executeWithRetry("b", {
      send: async () => boom("nonce too low")(),
      refetch: async () => "fresh",
      onRevert: (reason, cls, action) => seen.push([reason, cls, action]),
    });
    expect(seen.map(([, cls, action]) => `${cls}/${action}`)).toEqual([
      "unknown/refetch-retry",
      "unknown/mark-failed",
    ]);
  });
});

describe("settledThrough (never skip past a failure)", () => {
  const o = (status: string, from: number, to: number) =>
    ({ status, blockRange: [from, to] }) as never;

  test("advances across a leading run of settled batches", () => {
    expect(
      settledThrough([o("relayed", 1, 10), o("already", 11, 20), o("relayed", 21, 30)]),
    ).toBe(30);
  });

  test("stops at the first failure, even when a later batch succeeded", () => {
    expect(
      settledThrough([o("relayed", 1, 10), o("failed", 11, 20), o("relayed", 21, 30)]),
    ).toBe(10);
  });

  test("stops at a batch left pending by the finality guard", () => {
    expect(settledThrough([o("relayed", 1, 10), o("skipped", 11, 20)])).toBe(10);
  });

  test("a dry run never advances the cursor", () => {
    expect(settledThrough([o("dry-run", 1, 10), o("dry-run", 11, 20)])).toBeUndefined();
  });

  test("a leading failure blocks all advancement", () => {
    expect(settledThrough([o("failed", 1, 10), o("relayed", 11, 20)])).toBeUndefined();
  });

  test("no outcomes means nothing to advance past", () => {
    expect(settledThrough([])).toBeUndefined();
  });
});
