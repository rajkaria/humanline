import { describe, expect, test } from "bun:test";
import type { Address } from "viem";

import { pollFromTuple, readBallots, readPolls, validateDraft, viewOf, type Poll } from "@/lib/poll";

const ALICE: Address = "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3";

describe("validateDraft mirrors HumanPoll.createPoll", () => {
  test("accepts the boundaries", () => {
    expect(validateDraft("q", ["a", "b"], 600)).toEqual([]);
    expect(validateDraft("x".repeat(280), Array.from({ length: 8 }, (_, i) => `${"o".repeat(63)}${i}`), 90 * 86_400)).toEqual([]);
  });

  test("refuses what the contract refuses, in words", () => {
    expect(validateDraft("  ", ["a", "b"], 3600)).toContain("Ask a question.");
    expect(validateDraft("x".repeat(281), ["a", "b"], 3600)).toContain("The question is over 280 bytes.");
    expect(validateDraft("q", ["a"], 3600)).toContain("Give at least two options.");
    expect(validateDraft("q", Array.from({ length: 9 }, (_, i) => String(i)), 3600)).toContain("At most 8 options.");
    expect(validateDraft("q", ["a", ""], 3600)).toContain("Options cannot be empty.");
    expect(validateDraft("q", ["a", "b".repeat(65)], 3600)).toContain("Each option must be 64 bytes or fewer.");
    expect(validateDraft("q", ["Yes", "yes"], 3600)).toContain("Options must be different.");
    expect(validateDraft("q", ["a", "b"], 599)).toContain("Voting must stay open between 10 minutes and 90 days.");
    expect(validateDraft("q", ["a", "b"], 90 * 86_400 + 1)).toHaveLength(1);
  });

  test("counts bytes, not characters", () => {
    expect(validateDraft("é".repeat(141), ["a", "b"], 3600)).toContain("The question is over 280 bytes.");
    expect(validateDraft("é".repeat(140), ["a", "b"], 3600)).toEqual([]);
  });
});

const poll = (tally: bigint[], closesAt = 2_000): Poll => ({
  id: 0n,
  creator: ALICE,
  creatorHuman: 7n,
  closesAt,
  question: "q",
  options: tally.map((_, i) => `o${i}`),
  tally,
  voters: tally.reduce((a, b) => a + b, 0n),
});

describe("viewOf", () => {
  test("percentages, leader and open state", () => {
    const v = viewOf(poll([1n, 2n, 0n]), 1_999);
    expect(v.open).toBe(true);
    expect(v.percent).toEqual([33.3, 66.7, 0]);
    expect(v.leader).toBe(1);
    expect(viewOf(poll([1n, 2n]), 2_000).open).toBe(false);
  });

  test("no leader on a tie or an empty poll", () => {
    expect(viewOf(poll([2n, 2n]), 0).leader).toBeNull();
    expect(viewOf(poll([0n, 0n]), 0)).toMatchObject({ leader: null, percent: [0, 0] });
  });
});

describe("reads", () => {
  const tuple = (q: string) => [ALICE, 7n, 5_000n, q, ["yes", "no"], [3n, 1n], 4n] as const;
  const client = {
    readContract: async (req: { functionName: string; args?: readonly bigint[] }) => {
      if (req.functionName === "pollCount") return 3n;
      if (req.functionName === "getPoll") return tuple(`poll ${req.args![0]}`);
      if (req.functionName === "ballotOf") return req.args![0] === 2n ? 2n : 0n;
      throw new Error(req.functionName);
    },
  } as never;

  test("newest first, limited", async () => {
    const polls = await readPolls(client, ALICE, 2);
    expect(polls.map((p) => p.id)).toEqual([2n, 1n]);
    expect(polls[0]).toEqual(pollFromTuple(2n, tuple("poll 2")));
    expect(polls[0]!.closesAt).toBe(5_000);
  });

  test("ballots decode option + 1, and a non-human has none", async () => {
    const ballots = await readBallots(client, ALICE, 9n, [2n, 1n]);
    expect(ballots.get(2n)).toBe(1);
    expect(ballots.get(1n)).toBeNull();
    expect((await readBallots(client, ALICE, 0n, [2n])).size).toBe(0);
  });
});
