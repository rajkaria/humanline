import { describe, expect, test } from "bun:test";

import { byteLength, histogram, intrinsicGas, ols, ols2, percentile, summarize } from "@/lib/measure/stats";

describe("ols", () => {
  test("recovers an exact line", () => {
    const fit = ols([
      [1, 250_000],
      [2, 330_000],
      [3, 410_000],
      [10, 970_000],
    ])!;
    expect(fit.intercept).toBeCloseTo(170_000, 6);
    expect(fit.slope).toBeCloseTo(80_000, 6);
    expect(fit.r2).toBeCloseTo(1, 9);
    expect(fit.n).toBe(4);
  });

  test("reports a weaker fit for noisy points", () => {
    const fit = ols([
      [1, 10],
      [2, 30],
      [3, 20],
      [4, 40],
    ])!;
    expect(fit.slope).toBeCloseTo(8, 6); // sxy 40 / sxx 5
    expect(fit.r2).toBeLessThan(1);
    expect(fit.r2).toBeGreaterThan(0.5);
  });

  test("refuses to fit one point or a single x", () => {
    expect(ols([[1, 1]])).toBeNull();
    expect(
      ols([
        [2, 1],
        [2, 5],
      ]),
    ).toBeNull();
  });
});

describe("ols2", () => {
  test("recovers an exact plane: base + per member + per continuity root", () => {
    const truth = (m: number, r: number) => 60_000 + 180_000 * m + 520 * r;
    const pts: Array<[number, number, number]> = [
      [1, 8, truth(1, 8)],
      [2, 300, truth(2, 300)],
      [3, 20, truth(3, 20)],
      [4, 600, truth(4, 600)],
      [1, 400, truth(1, 400)],
    ];
    const fit = ols2(pts)!;
    expect(fit.intercept).toBeCloseTo(60_000, 3);
    expect(fit.b1).toBeCloseTo(180_000, 3);
    expect(fit.b2).toBeCloseTo(520, 5);
    expect(fit.r2).toBeCloseTo(1, 9);
  });

  test("refuses collinear regressors and too few points", () => {
    expect(
      ols2([
        [1, 2, 3],
        [2, 4, 5],
        [3, 6, 7],
      ]),
    ).toBeNull();
    expect(ols2([[1, 2, 3]])).toBeNull();
  });
});

describe("percentiles and summaries", () => {
  test("nearest-rank percentiles", () => {
    const v = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 90)).toBe(9);
    expect(percentile(v, 100)).toBe(10);
    expect(percentile(v, 0)).toBe(1);
    expect(percentile([], 50)).toBeNull();
  });

  test("summaries", () => {
    expect(summarize([3, 1, 2])).toEqual({ count: 3, min: 1, p50: 2, p90: 3, max: 3, mean: 2 });
    expect(summarize([])).toBeNull();
  });

  test("histogram buckets cover the range with no gaps", () => {
    expect(histogram([0, 5, 12, 29], 10)).toEqual([
      { from: 0, to: 10, count: 2 },
      { from: 10, to: 20, count: 1 },
      { from: 20, to: 30, count: 1 },
    ]);
    expect(histogram([], 10)).toEqual([]);
  });
});

describe("gas and bytes", () => {
  test("intrinsic gas counts zero and non-zero calldata bytes", () => {
    expect(intrinsicGas("0x")).toBe(21_000);
    expect(intrinsicGas("0x0001ff00")).toBe(21_000 + 4 + 16 + 16 + 4);
  });

  test("byte length of hex", () => {
    expect(byteLength("0x")).toBe(0);
    expect(byteLength("0xdeadbeef")).toBe(4);
  });
});
