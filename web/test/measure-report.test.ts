import { describe, expect, test } from "bun:test";

import type { Measurements } from "@/lib/measure/collect";
import { decodeProbeOutput, decodeRelayInput, densestWindow, probeInput } from "@/lib/measure/collect";
import { END, START, renderMeasurements, spliceMeasurements } from "@/lib/measure/report";
import { encodeAbiParameters, encodeFunctionData, type Hex } from "viem";
import { attestedWorldIdAbi, relayRewardAbi } from "@/lib/abi";

const m: Measurements = {
  generatedAt: "2026-09-13T06:35:20.781Z",
  cc3: { chainId: 102031, head: 5_479_331, blockGasLimit: 75_000_000 },
  relayTxs: [],
  gasByBatchSize: [
    { n: 1, observed: 14, min: 237_972, median: 276_500, max: 279_188 },
    { n: 2, observed: 6, min: 496_720, median: 520_016, max: 633_808 },
  ],
  liveFit: { intercept: 79_441, slope: 211_007, r2: 0.906, n: 23 },
  liveModel: null,
  probe: {
    points: [
      { n: 1, ok: true, executionGas: 193_280, txGas: 295_500, calldataBytes: 8_164, continuityRoots: 8, fromBlock: 1, toBlock: 1 },
      { n: 2, ok: false, executionGas: 90_000, txGas: 120_000, calldataBytes: 9_000, continuityRoots: 300, error: "NotFinal", fromBlock: 1, toBlock: 2 },
    ],
    fit: null,
    model: null,
    note: "2 consecutive updates.",
  },
  anchors: {
    attestationReadGas: 3_125,
    checkpointReadGas: 3_125,
    verify: [{ txHash: "0x366786038986b2f9e70e1fc1b2be3a419b7a4a3ef36732ed48bcd4083d058bb7", chainKey: 1, anchor: "checkpoint", continuityRoots: 38, gas: 12_908, ok: true }],
    verifyFit: { intercept: 11_100, slope: 48, r2: 0.99, n: 5 },
  },
  cap: { tenError: "QueryAlreadyProcessed", elevenError: "BatchTooLarge", projectedGasAt10: 3_048_655, headroomAt10: 24 },
  latency: {
    summary: { count: 44, min: 826, p50: 1_908, p90: 8_596, max: 10_015, mean: 3_472 },
    spanHours: 20.58,
    byRelay: { sepolia: null },
    series: [],
  },
  proofSizes: {
    calldata: { count: 31, min: 3_684, p50: 6_564, p90: 31_268, max: 39_876, mean: 13_007 },
    txBytes: null,
    continuityRoots: null,
    histogram: [
      { from: 2_000, to: 4_000, count: 1 },
      { from: 4_000, to: 6_000, count: 0 },
    ],
  },
  precompile: {
    fromBlock: 5_478_332,
    toBlock: 5_479_331,
    hours: 4.16,
    logs: 1_415,
    txs: 1_052,
    callers: [
      { to: "0x2d8a4d5a34120ff9742d7a4dad37f4ff6335c118", txs: 669, humanline: false },
      { to: "0x3a7c3cc67034197208923587b8dc5c4674cbcef7", txs: 6, humanline: true },
    ],
    humanlineTxs: 6,
    humanlineShare: 6 / 1_052,
  },
};

describe("renderMeasurements", () => {
  const md = renderMeasurements(m);

  test("is fenced by the generated-block markers", () => {
    expect(md.startsWith(START)).toBe(true);
    expect(md.endsWith(END)).toBe(true);
  });

  test("prints the numbers, formatted", () => {
    expect(md).toContain("| 1 | 14 | 237,972 | 276,500 | 279,188 |");
    expect(md).toContain("gas ≈ 79,441 + 211,007 · updates (R² 0.906, 23 points)");
    expect(md).toContain("`BatchTooLarge`");
    expect(md).toContain("fits 24 times in one CC3 block");
    expect(md).toContain("| 2 | 300 | 9,000 | 90,000 | 120,000 | NotFinal |");
    expect(md).toContain("| both | 44 | 13.8 min | 31.8 min | 2.39 h | 2.78 h |");
    expect(md).toContain("Humanline sent 6 of them (0.57%)");
    expect(md).toContain("| `0x3a7c3c…cef7` | 6 | 0.57% | yes |");
  });

  test("says so when a fit is impossible, and drops empty histogram buckets", () => {
    expect(md).toContain("not enough independent points to fit");
    expect(md).not.toContain("| 4,000–6,000 | 0 |");
    expect(md).toContain("| sepolia | 0 | — | — | — | — |");
  });
});

describe("spliceMeasurements", () => {
  test("replaces only the generated block", () => {
    const doc = `# Measurements\n\nHand-written intro.\n\n${START}\nold\n${END}\n\n## Hand-written outro\n`;
    const out = spliceMeasurements(doc, `${START}\nnew\n${END}`);
    expect(out).toBe(`# Measurements\n\nHand-written intro.\n\n${START}\nnew\n${END}\n\n## Hand-written outro\n`);
  });

  test("appends when there is no block yet", () => {
    expect(spliceMeasurements("# M\n", "BLOCK")).toBe("# M\n\nBLOCK\n");
  });
});

describe("collect helpers", () => {
  const continuity = { lowerEndpointDigest: `0x${"11".repeat(32)}` as Hex, roots: [`0x${"22".repeat(32)}` as Hex] };
  const merkle = { root: `0x${"33".repeat(32)}` as Hex, siblings: [] };
  const args = [1n, [5n, 6n], ["0xaa", "0xbb"], [merkle, merkle], continuity] as const;

  test("decodes a direct relay and a vault relay to the same batch", () => {
    const direct = encodeFunctionData({ abi: attestedWorldIdAbi, functionName: "executeBatch", args });
    const vault = encodeFunctionData({
      abi: relayRewardAbi,
      functionName: "relay",
      args: ["0x3a7c3cc67034197208923587b8dc5c4674cbcef7", ...args],
    });
    expect(decodeRelayInput(direct)?.via).toBe("direct");
    expect(decodeRelayInput(vault)?.via).toBe("vault");
    expect(decodeRelayInput(vault)?.args[1]).toEqual([5n, 6n]);
    expect(decodeRelayInput("0xdeadbeef")).toBeNull();
  });

  test("probe input and output round-trip", () => {
    expect(probeInput("0x00000000000000000000000000000000ca5e0002", "0x1234")).toBe(
      encodeAbiParameters([{ type: "address" }, { type: "bytes" }], ["0x00000000000000000000000000000000ca5e0002", "0x1234"]),
    );
    const out = encodeAbiParameters([{ type: "bool" }, { type: "uint256" }, { type: "bytes" }], [true, 193_280n, "0x"]);
    expect(decodeProbeOutput(out)).toEqual({ ok: true, gas: 193_280, ret: "0x" });
  });

  test("densestWindow picks the longest run inside one proof span, capped at the batch limit", () => {
    const at = (...blocks: number[]) => blocks.map((block) => ({ block }));
    expect(densestWindow(at(100, 400, 2_000, 2_300, 2_600, 2_900), 1_000).map((x) => x.block)).toEqual([2_000, 2_300, 2_600, 2_900]);
    expect(densestWindow(at(...Array.from({ length: 15 }, (_, i) => i)), 1_000, 10)).toHaveLength(10);
    expect(densestWindow([], 1_000)).toEqual([]);
  });
});
