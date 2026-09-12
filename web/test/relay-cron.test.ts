import { describe, expect, test } from "bun:test";

import { dispatchRequest, isAuthorizedCron, shouldAlert } from "@/lib/relay/cron";

const SECRET = "s3cret-s3cret-s3cret";

describe("isAuthorizedCron", () => {
  test("accepts exactly `Bearer <secret>`", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  test("refuses a wrong, missing or differently formatted header", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer ", SECRET)).toBe(false);
  });

  test("an unset or short secret refuses everyone, including an empty bearer", () => {
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer short", "short")).toBe(false);
  });
});

describe("dispatchRequest", () => {
  test("targets relay.yml on main with the token and inputs", () => {
    const { url, init } = dispatchRequest({ token: "t", repo: "rajkaria/humanline", inputs: { source: "all" } });
    expect(url).toBe("https://api.github.com/repos/rajkaria/humanline/actions/workflows/relay.yml/dispatches");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
    expect(JSON.parse(init.body as string)).toEqual({ ref: "main", inputs: { source: "all" } });
  });

  test("rejects a repo that is not owner/name", () => {
    expect(() => dispatchRequest({ token: "t", repo: "https://evil.example/x" })).toThrow();
  });
});

describe("shouldAlert", () => {
  test("ok never alerts", () => {
    expect(shouldAlert({ status: "ok", waitingSec: 0 })).toBe(false);
  });

  test("late alerts in the interval right after crossing the SLO, then stays quiet", () => {
    expect(shouldAlert({ status: "late", waitingSec: 700 })).toBe(true);
    expect(shouldAlert({ status: "late", waitingSec: 1_200 })).toBe(false);
  });

  test("stalled alerts once when it crosses the stall threshold", () => {
    expect(shouldAlert({ status: "stalled", waitingSec: 3_700 })).toBe(true);
    expect(shouldAlert({ status: "stalled", waitingSec: 7_200 })).toBe(false);
  });
});
