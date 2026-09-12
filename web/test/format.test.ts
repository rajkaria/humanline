import { describe, expect, test } from "bun:test";

import {
  describeError,
  formatBps,
  formatCount,
  formatCtc,
  formatDuration,
  formatRatio,
  formatRelativeTime,
  formatTerm,
  formatTimestamp,
  formatUnits,
  formatUsd,
  groupDigits,
  isAddress,
  isTxHash,
  joinNonEmpty,
  parseUnits,
  parseUsd,
  toHex32,
  truncateAddress,
  truncateHex,
  truncateUint256,
} from "@/lib/format";

const ELLIPSIS = "…";

describe("truncateHex", () => {
  test("keeps the 0x prefix and elides the middle", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(truncateHex(hash)).toBe(`0xababab${ELLIPSIS}abab`);
  });

  test("leaves short values untouched", () => {
    expect(truncateHex("0x1234")).toBe("0x1234");
    expect(truncateHex("")).toBe("");
    expect(truncateHex("short")).toBe("short");
  });

  test("handles values with no 0x prefix", () => {
    expect(truncateHex("abcdefabcdefabcdef", 4, 4)).toBe(`abcd${ELLIPSIS}cdef`);
  });

  test("truncateAddress uses 4+4", () => {
    expect(truncateAddress("0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3")).toBe(
      `0x45B9${ELLIPSIS}CCA3`,
    );
  });
});

describe("toHex32 / truncateUint256", () => {
  test("renders a bigint as a padded 32-byte word", () => {
    expect(toHex32(0n)).toBe(`0x${"0".repeat(64)}`);
    expect(toHex32(255n)).toBe(`0x${"0".repeat(62)}ff`);
    expect(toHex32(255n)).toHaveLength(66);
  });

  test("accepts a decimal string, which is how roots arrive from logs", () => {
    expect(toHex32("255")).toBe(toHex32(255n));
  });

  test("truncates the hex form, not the decimal form", () => {
    expect(truncateUint256(255n)).toBe(`0x000000${ELLIPSIS}00ff`);
  });
});

describe("formatUnits", () => {
  test("formats hUSD's six decimals", () => {
    expect(formatUnits(25_000_000n, 6)).toBe("25.00");
    expect(formatUnits(1_234_567n, 6)).toBe("1.23");
    expect(formatUnits(0n, 6)).toBe("0.00");
  });

  test("truncates rather than rounds, so nobody is over-charged by display", () => {
    expect(formatUnits(1_999_999n, 6)).toBe("1.99");
  });

  test("groups thousands", () => {
    expect(formatUnits(1_234_567_890_123n, 6)).toBe("1,234,567.89");
    expect(formatUnits(1_234_567_890_123n, 6, { group: false })).toBe("1234567.89");
  });

  test("respects minFraction and maxFraction", () => {
    expect(formatUnits(1_500_000n, 6, { maxFraction: 4, minFraction: 0 })).toBe("1.5");
    expect(formatUnits(1_000_000n, 6, { maxFraction: 4, minFraction: 0 })).toBe("1");
    expect(formatUnits(1_000_000n, 6, { minFraction: 4 })).toBe("1.0000");
  });

  test("handles negative values", () => {
    expect(formatUnits(-25_000_000n, 6)).toBe("-25.00");
  });

  test("formatUsd and formatCtc bind the right decimals", () => {
    expect(formatUsd(25_000_000n)).toBe("25.00");
    expect(formatCtc(1_500_000_000_000_000_000n)).toBe("1.5");
    expect(formatCtc(10n ** 18n)).toBe("1");
  });

  test("survives values far beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = 10n ** 30n;
    expect(formatUnits(huge, 6)).toBe("1,000,000,000,000,000,000,000,000.00");
  });
});

describe("parseUnits", () => {
  test("parses well-formed decimals", () => {
    expect(parseUnits("25", 6)).toBe(25_000_000n);
    expect(parseUnits("25.5", 6)).toBe(25_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits(" 1.5 ", 6)).toBe(1_500_000n);
    expect(parseUnits("1.", 6)).toBe(1_000_000n);
    expect(parseUnits(".5", 6)).toBe(500_000n);
  });

  test("truncates extra precision instead of rounding up", () => {
    expect(parseUnits("1.9999999", 6)).toBe(1_999_999n);
  });

  test("rejects anything that is not a plain non-negative decimal", () => {
    for (const bad of ["", " ", ".", "abc", "-1", "1e6", "1,000", "1.2.3", "0x10", "Infinity"]) {
      expect(parseUnits(bad, 6)).toBeNull();
    }
  });

  test("parseUsd binds six decimals", () => {
    expect(parseUsd("20.20")).toBe(20_200_000n);
  });

  test("round-trips through formatUnits", () => {
    for (const input of ["0", "1", "25.5", "1234.56", "0.000001"]) {
      const parsed = parseUnits(input, 6)!;
      expect(parseUnits(formatUnits(parsed, 6, { maxFraction: 6, minFraction: 0, group: false }), 6)).toBe(
        parsed,
      );
    }
  });
});

describe("percentages", () => {
  test("formatBps renders basis points", () => {
    expect(formatBps(100)).toBe("1%");
    expect(formatBps(0)).toBe("0%");
    expect(formatBps(1250)).toBe("12.50%");
    expect(formatBps(10_000n)).toBe("100%");
  });

  test("formatRatio guards divide-by-zero", () => {
    expect(formatRatio(0n, 0n)).toBe("0.0%");
    expect(formatRatio(1n, 4n)).toBe("25.0%");
    expect(formatRatio(2n, 3n, 2)).toBe("66.66%");
  });
});

describe("durations", () => {
  test("formatDuration collapses to the two largest units", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(86_400)).toBe("1d");
    expect(formatDuration(86_400 + 3600 * 4)).toBe("1d 4h");
    expect(formatDuration(30n * 86_400n)).toBe("30d");
  });

  test("formatTerm renders contract constants in long form", () => {
    expect(formatTerm(30 * 86_400)).toBe("30 days");
    expect(formatTerm(86_400)).toBe("1 day");
    expect(formatTerm(7 * 86_400)).toBe("7 days");
    expect(formatTerm(600)).toBe("10 minutes");
    expect(formatTerm(300)).toBe("5 minutes");
    expect(formatTerm(3600)).toBe("1 hour");
    expect(formatTerm(0)).toBe("—");
    expect(formatTerm(90)).toBe("90 seconds");
  });
});

describe("timestamps", () => {
  const NOW = 1_757_000_000;

  test("formatRelativeTime reads naturally in both directions", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 10, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 240, NOW)).toBe("4m ago");
    expect(formatRelativeTime(NOW - 3 * 3600, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW + 240, NOW)).toBe("in 4m");
    expect(formatRelativeTime(0, NOW)).toBe("—");
  });

  test("formatTimestamp is UTC and stable between server and client", () => {
    expect(formatTimestamp(0)).toBe("—");
    expect(formatTimestamp(1_700_000_000)).toBe("2023-11-14 22:13:20 UTC");
  });
});

describe("validators", () => {
  test("isAddress accepts exactly 20 bytes of hex", () => {
    expect(isAddress("0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3")).toBe(true);
    expect(isAddress(" 0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3 ")).toBe(true);
    expect(isAddress("0x45B9")).toBe(false);
    expect(isAddress(`0x${"a".repeat(41)}`)).toBe(false);
    expect(isAddress(`${"a".repeat(40)}`)).toBe(false);
  });

  test("isTxHash accepts exactly 32 bytes of hex", () => {
    expect(isTxHash(`0x${"a".repeat(64)}`)).toBe(true);
    expect(isTxHash(`0x${"a".repeat(63)}`)).toBe(false);
    expect(isTxHash(`0x${"z".repeat(64)}`)).toBe(false);
  });
});

describe("describeError", () => {
  test("prefers viem's shortMessage", () => {
    expect(describeError({ shortMessage: "Execution reverted.", message: "long\nthing" })).toBe(
      "Execution reverted.",
    );
  });

  test("names the custom error when viem reports one", () => {
    const error = {
      shortMessage: "Execution reverted with reason.",
      metaMessages: ["Error: OverLimit(uint256 requested, uint256 available)"],
    };
    expect(describeError(error)).toContain("OverLimit");
  });

  test("falls back through details and message", () => {
    expect(describeError({ details: "user rejected" })).toBe("user rejected");
    expect(describeError({ message: "boom\nstack" })).toBe("boom");
    expect(describeError("plain string\nsecond line")).toBe("plain string");
  });

  test("never throws on odd inputs", () => {
    expect(describeError(null)).toBe("Unknown error");
    expect(describeError(undefined)).toBe("Unknown error");
    expect(describeError({})).toBe("Unknown error");
  });
});

describe("misc", () => {
  test("groupDigits inserts thousands separators", () => {
    expect(groupDigits("1")).toBe("1");
    expect(groupDigits("1000")).toBe("1,000");
    expect(groupDigits("1234567")).toBe("1,234,567");
  });

  test("formatCount accepts bigints and numbers", () => {
    expect(formatCount(13_000_000n)).toBe("13,000,000");
    expect(formatCount(42)).toBe("42");
  });

  test("joinNonEmpty drops falsy fragments", () => {
    expect(joinNonEmpty(["a", false, null, undefined, "b"])).toBe("a b");
    expect(joinNonEmpty([], ", ")).toBe("");
  });
});
