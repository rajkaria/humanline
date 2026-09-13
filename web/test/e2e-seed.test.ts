import { describe, expect, test } from "bun:test";

import { CREDIT_LOOP_EVIDENCE, LINK_EVIDENCE } from "@/lib/e2e";

describe("seeded demo evidence on /judge", () => {
  test("the credit loop comes from a seeded CreditLine v3 human, from registration to an on-time repay", () => {
    expect(CREDIT_LOOP_EVIDENCE?.source).toBe("seed");
    const labels = CREDIT_LOOP_EVIDENCE!.steps.map((s) => s.label);
    expect(labels).toContain("Register (Groth16 on CC3)");
    expect(labels).toContain("Repay on time");
    expect(BigInt(CREDIT_LOOP_EVIDENCE!.limitAfter!)).toBeGreaterThan(BigInt(CREDIT_LOOP_EVIDENCE!.limitBefore!));
    expect(CREDIT_LOOP_EVIDENCE!.repeats!.length).toBeGreaterThan(0);
  });

  test("the HumanLinks link names a human, a Creditcoin wallet and a transaction", () => {
    expect(LINK_EVIDENCE?.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(LINK_EVIDENCE?.linkedWallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(LINK_EVIDENCE?.linkCount).toBeGreaterThanOrEqual(1);
  });
});
