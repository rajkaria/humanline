import { describe, expect, test } from "bun:test";

import { RelayReportTimeoutError, runWithDeadline } from "@/lib/relay/deadline";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runWithDeadline", () => {
  test("returns the work's result when it finishes in time", async () => {
    expect(await runWithDeadline(async () => "report", 200)).toBe("report");
  });

  test("passes through the work's own failure", async () => {
    await expect(
      runWithDeadline(async () => {
        throw new Error("rpc down");
      }, 200),
    ).rejects.toThrow("rpc down");
  });

  test("answers at the deadline even while one call inside the work is still hanging", async () => {
    const started = Date.now();
    const hung = runWithDeadline(() => new Promise<never>(() => undefined), 50);
    await expect(hung).rejects.toBeInstanceOf(RelayReportTimeoutError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("aborts the signal so a windowed scan stops walking the chain", async () => {
    let windows = 0;
    let stoppedBy: unknown;
    const scan = async (signal: AbortSignal) => {
      while (!signal.aborted) {
        windows += 1;
        await sleep(5);
      }
      stoppedBy = signal.reason;
      return windows;
    };
    await expect(runWithDeadline(scan, 40)).rejects.toThrow("relay report timed out after 0s");
    await sleep(20);
    const seen = windows;
    await sleep(30);
    expect(windows).toBe(seen);
    expect(stoppedBy).toBeInstanceOf(RelayReportTimeoutError);
  });

  test("a late failure after the deadline is not an unhandled rejection", async () => {
    const late = runWithDeadline(async () => {
      await sleep(30);
      throw new Error("late");
    }, 5);
    await expect(late).rejects.toBeInstanceOf(RelayReportTimeoutError);
    await sleep(50);
  });
});
