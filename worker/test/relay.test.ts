// Batching, cursor derivation, finality ceiling and the retry policy. No network.
import { describe, expect, test } from "bun:test";
import { toBeHex, zeroPadValue } from "ethers";
import {
  CC3_LOG_WINDOW,
  classifyRevert,
  deriveCursor,
  executeWithRetry,
  finalScanCeiling,
  finalityDepth,
  groupIntoBatches,
  isRetryableLogError,
  membersAsSourceTxs,
  nextRetryAction,
  parseRootRelayed,
  relayedKey,
  settledThrough,
  shouldRetryWithFreshProof,
  type RelayContext,
  type RetryAction,
  type RevertClass,
} from "../src/relay";
import { BATCH_MAX_SIZE, BATCH_MAX_SPAN, SOURCES } from "../src/config";
import { loadAttestedWorldIdAbi } from "../src/abi";
import { computeQueryId, revertReason } from "../src/cc3";

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

// ---------------------------------------------------------------------------
// Fix round 1 — regression tests for the review's Critical/Important findings
// ---------------------------------------------------------------------------

describe("C1: QueryAlreadyProcessed is a success path, not an unknown revert", () => {
  test("the custom error AttestedWorldID.executeBatch reverts is recognised", () => {
    expect(
      classifyRevert(
        "QueryAlreadyProcessed(0xbba7da5b6a243076d24b390ebf1731aabc8d55520b3291dd310d531371dafc45)",
      ),
    ).toBe("already-processed");
  });

  test("the ASCBase require string still classifies the same way", () => {
    expect(classifyRevert("execution reverted: Query already processed")).toBe(
      "already-processed",
    );
    expect(classifyRevert("Query Already Processed")).toBe("already-processed");
  });

  test("it never refetches or resubmits", () => {
    expect(nextRetryAction("already-processed", 0)).toBe("mark-already");
    expect(shouldRetryWithFreshProof("already-processed")).toBe(false);
  });

  test("the real revert data decodes and classifies end to end", () => {
    const iface = loadAttestedWorldIdAbi().iface;
    const queryId = computeQueryId(1, 11687163, 58);
    const data = iface.encodeErrorResult("QueryAlreadyProcessed", [queryId]);
    const reason = revertReason({ data });
    expect(reason).toContain("QueryAlreadyProcessed");
    expect(classifyRevert(reason)).toBe("already-processed");
  });

  test("a batch that reverts this way is marked already, not failed", async () => {
    const iface = loadAttestedWorldIdAbi().iface;
    const data = iface.encodeErrorResult("QueryAlreadyProcessed", [computeQueryId(3, 1, 0)]);
    let refetches = 0;
    const res = await executeWithRetry("batch", {
      send: async () => {
        throw { data };
      },
      refetch: async () => {
        refetches += 1;
        return "fresh";
      },
      reasonOf: revertReason,
    });
    expect(res.kind).toBe("already");
    expect(refetches).toBe(0);
  });
});

describe("C2: the cursor never advances into a block with unsettled work", () => {
  const o = (status: string, from: number, to: number) =>
    ({ status, blockRange: [from, to] }) as never;

  test("two batches sharing a block: the second fails, so the shared block is rescanned", () => {
    // groupIntoBatches splits on member count, so block 500 can straddle two batches.
    expect(settledThrough([o("relayed", 100, 500), o("failed", 500, 900)])).toBe(499);
  });

  test("the same holds when the second batch is only pending", () => {
    expect(settledThrough([o("already", 100, 500), o("skipped", 500, 900)])).toBe(499);
  });

  test("a disjoint failure still allows the full settled range", () => {
    expect(settledThrough([o("relayed", 100, 500), o("failed", 501, 900)])).toBe(500);
  });

  test("an unsettled batch further down still clamps the leading run", () => {
    expect(
      settledThrough([o("relayed", 100, 300), o("relayed", 300, 400), o("failed", 250, 900)]),
    ).toBe(249);
  });

  test("no advance at all when clamping would go below zero", () => {
    expect(settledThrough([o("relayed", 0, 0), o("failed", 0, 5)])).toBeUndefined();
  });

  test("all settled is unaffected by the clamp", () => {
    expect(settledThrough([o("relayed", 100, 500), o("already", 500, 900)])).toBe(900);
  });
});

describe("I1: a retry refetches only the submission in flight", () => {
  const sourceTx = (txHash: string, blockNumber: number, txIndex: number) => ({
    txHash,
    blockNumber,
    txIndex,
    logIndex: 0,
    preRoot: 1n,
    kind: 0,
    postRoot: 2n,
  });
  const member = (txHash: string, blockHeight: number, txIndex: number) => ({
    txHash,
    blockHeight,
    txIndex,
    txBytes: "0x",
    merkleProof: { root: "0x", siblings: [] },
  });
  const batch = (members: ReturnType<typeof member>[]) =>
    ({
      chainKey: 1,
      fromHeader: members[0]!.blockHeight,
      toHeader: members[members.length - 1]!.blockHeight,
      members,
      continuityProof: { lowerEndpointDigest: "0x", roots: [] },
    }) as never;

  const group = [sourceTx("0xa", 10, 1), sourceTx("0xb", 11, 2), sourceTx("0xc", 12, 3)];

  test("selects only the batch's own members out of a larger scan group", () => {
    const subgroup = membersAsSourceTxs(batch([member("0xb", 11, 2)]), group);
    expect(subgroup.map((t) => t.txHash)).toEqual(["0xb"]);
  });

  test("preserves batch order and carries the real source metadata", () => {
    const subgroup = membersAsSourceTxs(batch([member("0xc", 12, 3), member("0xa", 10, 1)]), group);
    expect(subgroup.map((t) => t.txHash)).toEqual(["0xc", "0xa"]);
    expect(subgroup[1]).toMatchObject({ blockNumber: 10, txIndex: 1, preRoot: 1n });
  });

  test("hash matching is case-insensitive", () => {
    expect(membersAsSourceTxs(batch([member("0xB", 11, 2)]), group)[0]!.blockNumber).toBe(11);
  });

  test("synthesises an entry when the member is not in the group (the prove path)", () => {
    const subgroup = membersAsSourceTxs(batch([member("0xz", 99, 7)]), group);
    expect(subgroup).toHaveLength(1);
    expect(subgroup[0]).toMatchObject({ txHash: "0xz", blockNumber: 99, txIndex: 7 });
  });
});

describe("I2: RootRelayed events are keyed by block AND tx index", () => {
  const iface = loadAttestedWorldIdAbi().iface;
  const logOf = (
    sourceBlock: number,
    sourceTxIndex: number,
    preRoot: bigint,
    postRoot: bigint,
    humansAdded: number,
  ) => {
    const encoded = iface.encodeEventLog("RootRelayed", [
      computeQueryId(1, sourceBlock, sourceTxIndex),
      sourceBlock,
      postRoot,
      preRoot,
      0,
      humansAdded,
      sourceTxIndex,
      "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3",
    ]);
    return { topics: encoded.topics, data: encoded.data };
  };

  test("two members in one source block do not overwrite each other", () => {
    const relayed = parseRootRelayed([
      logOf(11687163, 58, 1n, 2n, 100),
      logOf(11687163, 59, 2n, 3n, 42),
    ]);
    expect(relayed.size).toBe(2);
    expect(relayed.get(relayedKey(11687163, 58))).toMatchObject({ postRoot: 2n, humansAdded: 100 });
    expect(relayed.get(relayedKey(11687163, 59))).toMatchObject({ postRoot: 3n, humansAdded: 42 });
  });

  test("a member looks up its own event, not its block-mate's", () => {
    const relayed = parseRootRelayed([logOf(500, 0, 7n, 8n, 5), logOf(500, 9, 8n, 9n, 6)]);
    expect(relayed.get(relayedKey(500, 9))!.preRoot).toBe(8n);
    expect(relayed.get(relayedKey(500, 0))!.preRoot).toBe(7n);
  });

  test("unrelated logs are ignored rather than throwing", () => {
    expect(parseRootRelayed([{ topics: ["0x00"], data: "0x" }, logOf(1, 0, 1n, 2n, 1)]).size).toBe(
      1,
    );
    expect(parseRootRelayed([]).size).toBe(0);
  });

  test("relayedKey is stable and distinguishes indices", () => {
    expect(relayedKey(11687163, 58)).toBe("11687163:58");
    expect(relayedKey(11687163, 58)).not.toBe(relayedKey(11687163, 59));
  });
});

describe("I3: FINALITY_DEPTH comes from the contract when one is deployed", () => {
  const baseCtx = (): RelayContext => ({
    source: SOURCES.sepolia,
    cc3: undefined as never,
    dryRun: true,
    log: () => {},
  });

  test("falls back to the source default when no contract address is known", async () => {
    const ctx = baseCtx();
    expect(await finalityDepth(ctx)).toBe(SOURCES.sepolia.finalityDepth);
    expect(ctx.resolvedFinalityDepth).toBe(SOURCES.sepolia.finalityDepth);
  });

  test("reads the deployed immutable and memoises it", async () => {
    let calls = 0;
    const runner = {
      provider: null,
      call: async () => {
        calls += 1;
        return zeroPadValue(toBeHex(64), 32);
      },
    };
    const ctx = {
      ...baseCtx(),
      cc3: runner as never,
      contractAddress: "0x2222222222222222222222222222222222222222",
    };
    expect(await finalityDepth(ctx)).toBe(64);
    expect(await finalityDepth(ctx)).toBe(64); // memoised
    expect(calls).toBe(1);
  });

  test("a depth of 0 is honoured, not treated as missing", async () => {
    const ctx = {
      ...baseCtx(),
      cc3: { provider: null, call: async () => zeroPadValue("0x00", 32) } as never,
      contractAddress: "0x2222222222222222222222222222222222222222",
    };
    expect(await finalityDepth(ctx)).toBe(0);
  });

  test("falls back to the default when the read reverts", async () => {
    const ctx = {
      ...baseCtx(),
      cc3: {
        provider: null,
        call: async () => {
          throw new Error("no contract code");
        },
      } as never,
      contractAddress: "0x2222222222222222222222222222222222222222",
    };
    expect(await finalityDepth(ctx)).toBe(SOURCES.sepolia.finalityDepth);
  });

  test("a non-default depth changes the scan ceiling accordingly", () => {
    expect(finalScanCeiling(1000, 990, 32)).toBe(958);
    expect(finalScanCeiling(1000, 990, 64)).toBe(926);
    expect(finalScanCeiling(1000, 990, 0)).toBe(990);
  });
});

describe("CC3 log-scan bounds (cursor recovery against the live RPC)", () => {
  test("the default CC3 window stays well inside the node's 10s query timeout", () => {
    // Measured on rpc.cc3-testnet: 50k ≈ 7s (intermittently times out), 10k ≈ 2.9s.
    expect(CC3_LOG_WINDOW).toBeLessThanOrEqual(10_000);
  });

  test("timeout and result-size complaints are retryable", () => {
    for (const msg of [
      "query timeout of 10 seconds exceeded",
      "too many results",
      "response size exceeded",
      "limit exceeded",
      "block range is too wide",
    ]) {
      expect(isRetryableLogError(new Error(msg))).toBe(true);
    }
  });

  test("a genuine error is not retried into an infinite shrink", () => {
    expect(isRetryableLogError(new Error("execution reverted"))).toBe(false);
    expect(isRetryableLogError(new Error("no contract code at address"))).toBe(false);
  });
});
