/**
 * Self-relay planning: what a user's wallet is asked to sign.
 *
 * Every rule here maps to a revert the contract would otherwise raise after the user
 * paid gas: skipping an update (`UnknownPreRoot`), a batch over ten (`BatchTooLarge`),
 * a batch wider than one continuity proof, or a root below the finality depth
 * (`NotFinal`).
 */

import { describe, expect, test } from "bun:test";

import {
  buildChain,
  etaFor,
  groupBatches,
  planFromJson,
  planRelay,
  planToJson,
  type PlanInput,
  type TreeChange,
} from "@/lib/relay/plan";

function change(n: number, block: number, overrides: Partial<TreeChange> = {}): TreeChange {
  return {
    txHash: `0x${n.toString(16).padStart(64, "0")}`,
    blockNumber: block,
    txIndex: n,
    logIndex: n,
    preRoot: BigInt(100 + n - 1),
    postRoot: BigInt(100 + n),
    kind: 0,
    ...overrides,
  };
}

/** Roots 100 → 101 → … → 100+count, one update every `gap` blocks from `start`. */
function history(count: number, start = 1_000, gap = 50): TreeChange[] {
  return Array.from({ length: count }, (_, i) => change(i + 1, start + i * gap));
}

function input(overrides: Partial<PlanInput> & { all: TreeChange[]; latestIdx: number | null; targetIdx: number }): PlanInput {
  const { all, latestIdx, targetIdx, ...rest } = overrides;
  const latestChange = latestIdx === null ? null : all[latestIdx]!;
  const targetChange = all[targetIdx]!;
  return {
    target: targetChange.postRoot,
    targetKnown: false,
    latestRoot: latestChange ? latestChange.postRoot : null,
    targetChange,
    latestChange,
    changes: all.filter(
      (c) => (!latestChange || c.blockNumber > latestChange.blockNumber) && c.blockNumber <= targetChange.blockNumber,
    ),
    attestedTip: 1_000_000,
    finalityDepth: 32,
    sourceBlockTime: 12,
    ...rest,
  };
}

describe("buildChain", () => {
  test("walks preRoot → postRoot links in source order", () => {
    const all = history(4);
    expect(buildChain(all.slice(1), 101n, 104n)?.map((c) => c.postRoot)).toEqual([102n, 103n, 104n]);
  });

  test("orders by block then log index even when the scan returned them shuffled", () => {
    const all = history(3);
    expect(buildChain([all[2]!, all[0]!, all[1]!], 100n, 103n)?.length).toBe(3);
  });

  test("two updates in one block are ordered by log index", () => {
    const a = change(1, 500, { logIndex: 7 });
    const b = change(2, 500, { logIndex: 9 });
    expect(buildChain([b, a], 100n, 102n)).toEqual([a, b]);
  });

  test("a missing link returns null instead of skipping it", () => {
    const all = history(4);
    expect(buildChain([all[0]!, all[2]!, all[3]!], 100n, 104n)).toBeNull();
  });

  test("before bootstrap the target's own update is the whole chain", () => {
    const all = history(3);
    expect(buildChain(all, null, 102n)).toEqual([all[1]!]);
  });

  test("a deletion is just another link", () => {
    const del = change(2, 1_050, { kind: 1 });
    expect(buildChain([change(1, 1_000), del, change(3, 1_100)], 100n, 103n)?.[1]?.kind).toBe(1);
  });
});

describe("groupBatches", () => {
  test("never more than ten members", () => {
    const sizes = groupBatches(history(23, 1_000, 1)).map((b) => b.length);
    expect(sizes).toEqual([10, 10, 3]);
  });

  test("splits when the span would exceed one continuity proof", () => {
    const chain = [change(1, 1_000), change(2, 1_900), change(3, 2_001), change(4, 2_100)];
    expect(groupBatches(chain).map((b) => b.length)).toEqual([2, 2]);
  });

  test("a span of exactly MAX_SPAN still fits", () => {
    expect(groupBatches([change(1, 0), change(2, 1_000)]).length).toBe(1);
  });

  test("rejects a non-positive size", () => {
    expect(() => groupBatches(history(2), { maxBatch: 0 })).toThrow();
  });
});

describe("etaFor", () => {
  test("rounds up to whole attestation steps", () => {
    expect(etaFor(0, 12)).toBe(0);
    expect(etaFor(1, 12)).toBe(120);
    expect(etaFor(10, 12)).toBe(120);
    expect(etaFor(11, 12)).toBe(240);
  });
});

describe("planRelay", () => {
  test("a root Creditcoin already accepts needs nothing", () => {
    const all = history(2);
    expect(planRelay({ ...input({ all, latestIdx: 0, targetIdx: 1 }), targetKnown: true })).toEqual({
      status: "known",
    });
  });

  test("one pending update, final → ready as a single one-member batch", () => {
    const all = history(2);
    const plan = planRelay(input({ all, latestIdx: 0, targetIdx: 1 }));
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.batches.length).toBe(1);
    expect(plan.batches[0]!.changes.map((c) => c.postRoot)).toEqual([102n]);
    expect(plan.batches[0]!.final).toBe(true);
    expect(plan.etaSeconds).toBe(0);
  });

  test("missing earlier roots are carried in the same transaction, oldest first", () => {
    const all = history(5);
    const plan = planRelay(input({ all, latestIdx: 1, targetIdx: 4 }));
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.batches.length).toBe(1);
    expect(plan.chain.map((c) => c.postRoot)).toEqual([103n, 104n, 105n]);
  });

  test("more than ten missing roots become several transactions", () => {
    const all = history(14, 1_000, 5);
    const plan = planRelay(input({ all, latestIdx: 0, targetIdx: 13 }));
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.batches.map((b) => b.changes.length)).toEqual([10, 3]);
  });

  test("not yet final → waiting, with how far the attested tip has to go", () => {
    const all = history(2, 1_000, 50); // target at block 1050, needs tip 1082
    const plan = planRelay(input({ all, latestIdx: 0, targetIdx: 1, attestedTip: 1_060 }));
    expect(plan.status).toBe("waiting");
    if (plan.status !== "waiting") return;
    expect(plan.needHeight).toBe(1_082);
    expect(plan.blocksToGo).toBe(22);
    expect(plan.etaSeconds).toBe(360);
    expect(plan.batches[0]!.final).toBe(false);
  });

  test("an earlier batch can be final while the last one is not", () => {
    const all = history(13, 1_000, 10); // blocks 1000..1120
    const plan = planRelay(input({ all, latestIdx: 0, targetIdx: 12, attestedTip: 1_140 }));
    expect(plan.status).toBe("waiting");
    if (plan.status !== "waiting") return;
    expect(plan.batches.map((b) => b.final)).toEqual([true, false]);
  });

  test("an unknown root is reported, not guessed at", () => {
    const all = history(2);
    const plan = planRelay({ ...input({ all, latestIdx: 0, targetIdx: 1 }), targetChange: null });
    expect(plan.status).toBe("not-found");
  });

  test("a root that belongs to the other World ID tree names that tree instead of a dead end", () => {
    // World App (Orb) proof opened on the staging profile: the root is on mainnet, not Sepolia.
    const all = history(2);
    const plan = planRelay({ ...input({ all, latestIdx: 0, targetIdx: 1 }), targetChange: null, otherTree: 3 });
    expect(plan.status).toBe("wrong-tree");
    if (plan.status !== "wrong-tree") return;
    expect(plan.chainKey).toBe(3);
    expect(plan.reason).toMatch(/Orb/);
  });

  test("a staging proof on the Orb profile points back at the staging tree", () => {
    const all = history(2);
    const plan = planRelay({ ...input({ all, latestIdx: 0, targetIdx: 1 }), targetChange: null, otherTree: 1 });
    expect(plan.status).toBe("wrong-tree");
    if (plan.status !== "wrong-tree") return;
    expect(plan.chainKey).toBe(1);
    expect(plan.reason).toMatch(/staging/);
  });

  test("the other tree is never consulted once the root is found on this one", () => {
    const all = history(2);
    const plan = planRelay({ ...input({ all, latestIdx: 0, targetIdx: 1 }), otherTree: 3 });
    expect(plan.status).toBe("ready");
  });

  test("a target update that does not carry the proof root is treated as not found", () => {
    const all = history(2);
    const plan = planRelay({ ...input({ all, latestIdx: 0, targetIdx: 1 }), target: 999n });
    expect(plan.status).toBe("not-found");
  });

  test("a proof older than Creditcoin's tip is stale: regenerate, do not side-fill", () => {
    const all = history(4);
    const plan = planRelay({
      ...input({ all, latestIdx: 3, targetIdx: 3 }),
      target: all[1]!.postRoot,
      targetChange: all[1]!,
    });
    expect(plan.status).toBe("stale");
  });

  test("Creditcoin's tip not found on the source chain → gap", () => {
    const all = history(3);
    const plan = planRelay({ ...input({ all, latestIdx: 0, targetIdx: 2 }), latestChange: null });
    expect(plan.status).toBe("gap");
  });

  test("a hole in the scanned updates → gap, never a partial relay", () => {
    const all = history(5);
    const base = input({ all, latestIdx: 0, targetIdx: 4 });
    const plan = planRelay({ ...base, changes: base.changes.filter((c) => c.postRoot !== 103n) });
    expect(plan.status).toBe("gap");
  });

  test("before bootstrap the target alone is relayed", () => {
    const all = history(3);
    const plan = planRelay(input({ all, latestIdx: null, targetIdx: 2 }));
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.chain).toEqual([all[2]!]);
  });

  test("updates after the target are never included", () => {
    const all = history(4);
    const base = input({ all, latestIdx: 0, targetIdx: 1 });
    const plan = planRelay({ ...base, changes: all.slice(1) });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.chain.map((c) => c.postRoot)).toEqual([102n]);
  });
});

describe("wire format", () => {
  test("round-trips bigints through JSON", () => {
    const all = history(3);
    const plan = planRelay(input({ all, latestIdx: 0, targetIdx: 2, attestedTip: 1_090 }));
    const back = planFromJson(JSON.parse(JSON.stringify(planToJson(plan))));
    expect(back).toEqual(plan);
  });

  test("reason-only statuses pass through unchanged", () => {
    const plan = { status: "gap" as const, reason: "x" };
    expect(planFromJson(planToJson(plan))).toEqual(plan);
  });

  test("wrong-tree keeps the chainKey it points at", () => {
    const all = history(1);
    const plan = planRelay({ ...input({ all, latestIdx: null, targetIdx: 0 }), targetChange: null, otherTree: 3 });
    expect(planFromJson(JSON.parse(JSON.stringify(planToJson(plan))))).toEqual(plan);
  });
});
