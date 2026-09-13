/**
 * Pure formatting helpers shared by every view.
 *
 * Nothing in here touches React, wagmi or the DOM, so it is all unit-testable
 * with `bun test` (see `web/test/format.test.ts`).
 */

/** Decimals for the demo stablecoin `hUSD` (matches `contracts/src/HUSD.sol`). */
export const HUSD_DECIMALS = 6;
/** Decimals for the Creditcoin native token. */
export const CTC_DECIMALS = 18;

/**
 * Shorten a hex string for display: `0x1234…cdef`.
 *
 * Anything that is not long enough to be worth truncating is returned as-is, so
 * this is safe to call on arbitrary strings.
 */
export function truncateHex(value: string, left = 6, right = 4): string {
  if (!value) return "";
  const hasPrefix = value.startsWith("0x") || value.startsWith("0X");
  const body = hasPrefix ? value.slice(2) : value;
  const prefix = hasPrefix ? value.slice(0, 2) : "";
  if (body.length <= left + right + 1) return value;
  return `${prefix}${body.slice(0, left)}…${body.slice(body.length - right)}`;
}

/** Address-flavoured truncation: `0x45B9…CCA3`. */
export function truncateAddress(address: string): string {
  return truncateHex(address, 4, 4);
}

/**
 * Truncate a decimal `uint256` (a World ID root or nullifier) after first
 * rendering it as 32-byte hex, which is how explorers and the contracts show it.
 */
export function truncateUint256(value: bigint | string, left = 6, right = 4): string {
  return truncateHex(toHex32(value), left, right);
}

/** Render a bigint (or decimal string) as a 0x-prefixed 32-byte hex word. */
export function toHex32(value: bigint | string): string {
  const asBigInt = typeof value === "bigint" ? value : BigInt(value);
  return `0x${asBigInt.toString(16).padStart(64, "0")}`;
}

/**
 * Format a fixed-point token amount for humans.
 *
 * `formatUnits(25_000_000n, 6)` → `"25.00"`; trailing zeros beyond `maxFraction`
 * are dropped, and thousands separators are applied to the integer part.
 */
export function formatUnits(
  value: bigint,
  decimals: number,
  options: { maxFraction?: number; minFraction?: number; group?: boolean } = {},
): string {
  const { maxFraction = 2, minFraction = 2, group = true } = options;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fractionRaw = (abs % base).toString().padStart(decimals, "0");

  let fraction = fractionRaw.slice(0, Math.max(0, Math.min(maxFraction, decimals)));
  while (fraction.length > minFraction && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  while (fraction.length < minFraction) fraction += "0";

  const wholeStr = group ? groupDigits(whole.toString()) : whole.toString();
  const sign = negative ? "-" : "";
  return fraction.length > 0 ? `${sign}${wholeStr}.${fraction}` : `${sign}${wholeStr}`;
}

/** `formatUnits` pre-bound to hUSD's 6 decimals. */
export function formatUsd(value: bigint, options?: Parameters<typeof formatUnits>[2]): string {
  return formatUnits(value, HUSD_DECIMALS, options);
}

/** `formatUnits` pre-bound to tCTC's 18 decimals, with a looser fraction. */
export function formatCtc(value: bigint): string {
  return formatUnits(value, CTC_DECIMALS, { maxFraction: 4, minFraction: 0 });
}

/** Insert thin thousands separators: `1234567` → `1,234,567`. */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format an integer counter (`rootCount`, `humanCount`, …). */
export function formatCount(value: bigint | number): string {
  return groupDigits(value.toString());
}

/**
 * Parse a user-entered decimal amount into fixed-point base units.
 *
 * Returns `null` for anything that is not a well-formed non-negative decimal,
 * which is what the borrow/repay/deposit forms use to disable their submit
 * buttons. Extra fractional digits beyond `decimals` are truncated, never
 * rounded, so a user can never be charged more than they typed.
 */
export function parseUnits(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return null;
  if (trimmed === "." ) return null;

  const [wholePart = "0", fractionPart = ""] = trimmed.split(".");
  const fraction = fractionPart.slice(0, decimals).padEnd(decimals, "0");
  const whole = wholePart === "" ? "0" : wholePart;
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction === "" ? "0" : fraction);
  } catch {
    return null;
  }
}

/** `parseUnits` pre-bound to hUSD's 6 decimals. */
export function parseUsd(input: string): bigint | null {
  return parseUnits(input, HUSD_DECIMALS);
}

/** Basis points as a percentage string: `100` → `"1%"`. */
export function formatBps(bps: bigint | number): string {
  const n = Number(bps) / 100;
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}

/** A ratio in [0, 1] as a percentage string. Guards divide-by-zero. */
export function formatRatio(numerator: bigint, denominator: bigint, fractionDigits = 1): string {
  if (denominator === 0n) return "0.0%";
  const scaled = (numerator * 10000n) / denominator;
  return `${(Number(scaled) / 100).toFixed(fractionDigits)}%`;
}

/**
 * Render an amount at full precision, ungrouped — for prefilling an input.
 *
 * `formatUsd` defaults to two fraction digits because that is what reads well in
 * a table. Prefilling a form with it silently truncates: a principal of
 * 20.205000 hUSD becomes "20.20", `repay` leaves 5000 base units outstanding,
 * and `CreditLine.repay` only settles the loan when the remainder reaches zero —
 * so the limit does not grow and the line does not close, with nothing on screen
 * explaining why. Every "Max" / "All" button uses this instead.
 */
export function formatUsdExact(value: bigint): string {
  return formatUnits(value, HUSD_DECIMALS, {
    maxFraction: HUSD_DECIMALS,
    minFraction: 0,
    group: false,
  });
}

/**
 * Pool shares are a raw integer, not a fixed-point token amount.
 *
 * `CreditLine.deposit` mints `assets * (totalShares + VIRTUAL_SHARES) / (totalAssets + 1)`
 * with `VIRTUAL_SHARES = 1e3`, so a first deposit of 60 hUSD (60,000,000 base
 * units) mints 60,000,000,000 shares — a thousand times the asset base units.
 * Formatting them with `formatUsd` showed "60,000.00" and invited a lender to
 * type "60" into the withdraw field, redeeming 0.06 hUSD.
 */
export const VIRTUAL_SHARES = 1000n;

/** Grouped integer: `60000000000` → `60,000,000,000`. */
export function formatShares(shares: bigint): string {
  return groupDigits(shares.toString());
}

/** Parse a raw share count. Rejects decimals — shares have no fractional part. */
export function parseShares(input: string): bigint | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/**
 * Assets a share count redeems for, matching `CreditLine.withdraw` exactly:
 * `assets = shares * (totalAssets + 1) / (totalShares + VIRTUAL_SHARES)`.
 */
export function sharesToAssets(
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  const denominator = totalShares + VIRTUAL_SHARES;
  if (denominator === 0n) return 0n;
  return (shares * (totalAssets + 1n)) / denominator;
}

/**
 * The inverse, matching `CreditLine.deposit`:
 * `shares = assets * (totalShares + VIRTUAL_SHARES) / (totalAssets + 1)`.
 */
export function assetsToShares(
  assets: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  return (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets + 1n);
}

const SECOND = 1;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Render a duration in seconds as a compact human string: `2d 4h`, `12m 30s`.
 *
 * Negative inputs are clamped to zero — callers that care about "overdue" state
 * check the sign themselves and choose different copy.
 */
export function formatDuration(seconds: number | bigint): string {
  let s = Math.floor(Number(seconds));
  if (!Number.isFinite(s) || s <= 0) return "0s";

  const days = Math.floor(s / DAY);
  s -= days * DAY;
  const hours = Math.floor(s / HOUR);
  s -= hours * HOUR;
  const minutes = Math.floor(s / MINUTE);
  s -= minutes * MINUTE;
  const secs = Math.floor(s / SECOND);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  return `${secs}s`;
}

/** Duration-style contract constants (`TERM`, `GRACE`) in long form: `30 days`. */
export function formatTerm(seconds: number | bigint): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "–";
  if (s % DAY === 0) return `${s / DAY} day${s / DAY === 1 ? "" : "s"}`;
  if (s % HOUR === 0) return `${s / HOUR} hour${s / HOUR === 1 ? "" : "s"}`;
  if (s % MINUTE === 0) return `${s / MINUTE} minute${s / MINUTE === 1 ? "" : "s"}`;
  return `${s} seconds`;
}

/**
 * Relative time for event feeds: `just now`, `4m ago`, `3h ago`, `2d ago`.
 * Future timestamps read as `in 4m`.
 */
export function formatRelativeTime(
  timestampSeconds: number | bigint,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const ts = Number(timestampSeconds);
  if (!Number.isFinite(ts) || ts <= 0) return "–";
  const delta = nowSeconds - ts;
  if (Math.abs(delta) < 45) return "just now";
  const body = formatDuration(Math.abs(delta));
  return delta > 0 ? `${body} ago` : `in ${body}`;
}

/** Absolute UTC timestamp, stable between server and client render. */
export function formatTimestamp(timestampSeconds: number | bigint): string {
  const ts = Number(timestampSeconds);
  if (!Number.isFinite(ts) || ts <= 0) return "–";
  const d = new Date(ts * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

/** `true` when a string looks like a 20-byte EVM address. */
export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/** `true` when a string looks like a 32-byte transaction hash. */
export function isTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

/**
 * Turn a thrown value from wagmi/viem into one short line a user can act on.
 *
 * viem errors carry a long multi-paragraph `message`; the first line plus the
 * revert reason is the part that matters, and custom errors from our contracts
 * (`OverLimit`, `NotHuman`, …) show up in `shortMessage`/`metaMessages`.
 */
export function describeError(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return firstLine(error);

  const err = error as {
    shortMessage?: string;
    details?: string;
    metaMessages?: string[];
    cause?: unknown;
    message?: string;
    name?: string;
  };

  const revert = err.metaMessages?.find((m) => m.includes("Error:") || m.includes("reverted"));
  if (err.shortMessage) {
    const named = extractCustomError(err.metaMessages?.join("\n") ?? "");
    return named ? `${named}: ${firstLine(err.shortMessage)}` : firstLine(err.shortMessage);
  }
  if (revert) return firstLine(revert);
  if (err.details) return firstLine(err.details);
  if (err.message) return firstLine(err.message);
  return "Unknown error";
}

/** Pull `SomeCustomError(...)` out of viem's meta messages, when present. */
function extractCustomError(text: string): string | null {
  const match = text.match(/Error:\s*([A-Za-z_][A-Za-z0-9_]*)\(/);
  return match ? match[1] : null;
}

function firstLine(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return line ?? text.trim();
}

/** Join class-name-ish fragments, skipping falsy ones. Used in plain strings. */
export function joinNonEmpty(parts: Array<string | false | null | undefined>, sep = " "): string {
  return parts.filter((p): p is string => Boolean(p)).join(sep);
}
