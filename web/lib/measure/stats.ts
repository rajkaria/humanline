/**
 * Small, pure statistics for the published measurements. Kept dependency-free and unit-tested,
 * because every number in `docs/MEASUREMENTS.md` passes through one of these.
 */

import type { Hex } from "viem";

export type Fit = { intercept: number; slope: number; r2: number; n: number };

/** Ordinary least squares `y = intercept + slope · x`. Needs two distinct x values. */
export function ols(points: ReadonlyArray<readonly [number, number]>): Fit | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, r2, n };
}

export type Fit2 = { intercept: number; b1: number; b2: number; r2: number; n: number };

/** Least squares with two regressors, `y = intercept + b1 · x1 + b2 · x2`. Null when degenerate. */
export function ols2(points: ReadonlyArray<readonly [number, number, number]>): Fit2 | null {
  const n = points.length;
  if (n < 3) return null;
  const m1 = points.reduce((s, [a]) => s + a, 0) / n;
  const m2 = points.reduce((s, [, b]) => s + b, 0) / n;
  const my = points.reduce((s, [, , y]) => s + y, 0) / n;
  let s11 = 0;
  let s22 = 0;
  let s12 = 0;
  let s1y = 0;
  let s2y = 0;
  let syy = 0;
  for (const [a, b, y] of points) {
    const d1 = a - m1;
    const d2 = b - m2;
    const dy = y - my;
    s11 += d1 * d1;
    s22 += d2 * d2;
    s12 += d1 * d2;
    s1y += d1 * dy;
    s2y += d2 * dy;
    syy += dy * dy;
  }
  const det = s11 * s22 - s12 * s12;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = (s1y * s22 - s2y * s12) / det;
  const b2 = (s2y * s11 - s1y * s12) / det;
  const intercept = my - b1 * m1 - b2 * m2;
  let sse = 0;
  for (const [a, b, y] of points) sse += (y - (intercept + b1 * a + b2 * b)) ** 2;
  return { intercept, b1, b2, r2: syy === 0 ? 1 : 1 - sse / syy, n };
}

/** Nearest-rank percentile of an unsorted sample (p in 0..100). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

export type Summary = { count: number; min: number; p50: number; p90: number; max: number; mean: number };

export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  return {
    count: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50)!,
    p90: percentile(values, 90)!,
    max: Math.max(...values),
    mean: values.reduce((s, v) => s + v, 0) / values.length,
  };
}

/** Counts per `[lo, lo + width)` bucket, from the lowest value's bucket to the highest's. */
export function histogram(values: readonly number[], width: number): Array<{ from: number; to: number; count: number }> {
  if (values.length === 0 || width <= 0) return [];
  const lo = Math.floor(Math.min(...values) / width) * width;
  const hi = Math.floor(Math.max(...values) / width) * width;
  const buckets: Array<{ from: number; to: number; count: number }> = [];
  for (let from = lo; from <= hi; from += width) buckets.push({ from, to: from + width, count: 0 });
  for (const v of values) {
    const bucket = buckets[Math.floor((v - lo) / width)];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

/** Intrinsic gas of a call transaction: 21,000 plus 4 per zero and 16 per non-zero calldata byte. */
export function intrinsicGas(data: Hex): number {
  let gas = 21_000;
  for (let i = 2; i < data.length; i += 2) gas += data.slice(i, i + 2) === "00" ? 4 : 16;
  return gas;
}

/** Bytes in a hex string. */
export const byteLength = (data: Hex | string) => Math.max(0, (data.length - 2) / 2);
