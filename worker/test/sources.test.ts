// Log-window planning and source-transaction ordering. No network.
import { describe, expect, test } from "bun:test";
import { LOG_WINDOW, SOURCES, sourceRpcUrls } from "../src/config";
import {
  parseTreeChangedLog,
  planWindows,
  toOrderedSourceTxs,
  type TreeChangedEvent,
} from "../src/sources";

describe("planWindows", () => {
  test("a single window covers a short range inclusively", () => {
    expect(planWindows(100, 200, 5000)).toEqual([[100, 200]]);
  });

  test("splits into windows of at most `size` blocks", () => {
    expect(planWindows(0, 12_000, 5000)).toEqual([
      [0, 4999],
      [5000, 9999],
      [10000, 12000],
    ]);
  });

  test("windows are contiguous and never overlap", () => {
    const windows = planWindows(7, 30_007, 5000);
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]![0]).toBe(windows[i - 1]![1] + 1);
    }
    expect(windows[0]![0]).toBe(7);
    expect(windows[windows.length - 1]![1]).toBe(30_007);
  });

  test("an exact multiple does not produce a trailing empty window", () => {
    expect(planWindows(0, 9999, 5000)).toHaveLength(2);
  });

  test("an inverted or empty range yields nothing", () => {
    expect(planWindows(200, 100)).toEqual([]);
  });

  test("a single block is one window", () => {
    expect(planWindows(42, 42)).toEqual([[42, 42]]);
  });

  test("the default window stays under common public-RPC caps", () => {
    expect(LOG_WINDOW).toBe(5000);
    expect(planWindows(0, 4999)).toHaveLength(1);
  });

  test("rejects a non-positive window size", () => {
    expect(() => planWindows(0, 10, 0)).toThrow("window size must be positive");
  });
});

describe("toOrderedSourceTxs", () => {
  const ev = (
    blockNumber: number,
    logIndex: number,
    txHash: string,
    txIndex = 0,
  ): TreeChangedEvent => ({
    blockNumber,
    logIndex,
    txHash,
    txIndex,
    preRoot: BigInt(blockNumber),
    kind: 0,
    postRoot: BigInt(blockNumber + 1),
  });

  test("orders by block then log index regardless of input order", () => {
    const out = toOrderedSourceTxs([
      ev(200, 1, "0xc"),
      ev(100, 5, "0xb"),
      ev(100, 2, "0xa"),
    ]);
    expect(out.map((t) => t.txHash)).toEqual(["0xa", "0xb", "0xc"]);
  });

  test("collapses multiple logs from one transaction into a single entry", () => {
    const out = toOrderedSourceTxs([ev(100, 2, "0xa"), ev(100, 3, "0xa")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.logIndex).toBe(2);
  });

  test("deduplication is case-insensitive on the hash", () => {
    expect(toOrderedSourceTxs([ev(100, 2, "0xAB"), ev(101, 0, "0xab")])).toHaveLength(1);
  });

  test("carries the tree change through", () => {
    const out = toOrderedSourceTxs([ev(100, 0, "0xa", 7)]);
    expect(out[0]).toMatchObject({ blockNumber: 100, txIndex: 7, preRoot: 100n, postRoot: 101n });
  });

  test("an empty scan yields nothing", () => {
    expect(toOrderedSourceTxs([])).toEqual([]);
  });
});

describe("parseTreeChangedLog", () => {
  test("reads preRoot, kind and postRoot out of the indexed topics", () => {
    const e = parseTreeChangedLog({
      blockNumber: 11687163,
      index: 4,
      transactionHash: "0x36",
      transactionIndex: 58,
      topics: [
        "0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04",
        `0x${"0".repeat(63)}7`,
        `0x${"0".repeat(63)}1`,
        `0x${"0".repeat(62)}ff`,
      ],
    });
    expect(e).toEqual({
      blockNumber: 11687163,
      logIndex: 4,
      txHash: "0x36",
      txIndex: 58,
      preRoot: 7n,
      kind: 1,
      postRoot: 255n,
    });
  });
});

describe("sourceRpcUrls", () => {
  const withEnv = <T>(key: string, value: string | undefined, fn: () => T): T => {
    const prev = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  };

  test("the documented default comes first, with fallbacks behind it", () => {
    const urls = withEnv("ETH_MAINNET_RPC", undefined, () => sourceRpcUrls(SOURCES.mainnet));
    expect(urls[0]).toBe("https://ethereum-rpc.publicnode.com");
    expect(urls.length).toBeGreaterThan(1);
  });

  test("an env override takes priority but keeps the fallbacks", () => {
    const urls = withEnv("ETH_SEPOLIA_RPC", "https://my-node.example", () =>
      sourceRpcUrls(SOURCES.sepolia),
    );
    expect(urls[0]).toBe("https://my-node.example");
    expect(urls).toContain("https://sepolia.gateway.tenderly.co");
  });

  test("a comma-separated override becomes an ordered list", () => {
    const urls = withEnv("ETH_MAINNET_RPC", "https://a.example, https://b.example", () =>
      sourceRpcUrls(SOURCES.mainnet),
    );
    expect(urls.slice(0, 2)).toEqual(["https://a.example", "https://b.example"]);
  });

  test("never lists the same endpoint twice", () => {
    const urls = withEnv("ETH_MAINNET_RPC", "https://mainnet.gateway.tenderly.co", () =>
      sourceRpcUrls(SOURCES.mainnet),
    );
    expect(new Set(urls).size).toBe(urls.length);
  });
});
