/**
 * `/vote`: reading `HumanPoll` and validating a new poll the way the contract will, so the form
 * refuses what the chain would refuse before a wallet is asked to sign.
 */

import type { Address, PublicClient } from "viem";

import { humanPollAbi } from "@/lib/abi";

export const MAX_OPTIONS = 8;
export const MAX_QUESTION_BYTES = 280;
export const MAX_OPTION_BYTES = 64;
export const MIN_DURATION = 10 * 60;
export const MAX_DURATION = 90 * 24 * 60 * 60;

export type Poll = {
  id: bigint;
  creator: Address;
  creatorHuman: bigint;
  closesAt: number;
  question: string;
  options: string[];
  tally: bigint[];
  voters: bigint;
};

export type PollView = Poll & {
  open: boolean;
  /** Share of voters per option, 0..100, rounded to one decimal. */
  percent: number[];
  leader: number | null;
};

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Human-readable problems with a draft poll; empty when the contract would accept it. */
export function validateDraft(question: string, options: string[], durationSeconds: number): string[] {
  const problems: string[] = [];
  const q = question.trim();
  if (bytes(q) === 0) problems.push("Ask a question.");
  if (bytes(q) > MAX_QUESTION_BYTES) problems.push(`The question is over ${MAX_QUESTION_BYTES} bytes.`);
  const opts = options.map((o) => o.trim());
  if (opts.length < 2) problems.push("Give at least two options.");
  if (opts.length > MAX_OPTIONS) problems.push(`At most ${MAX_OPTIONS} options.`);
  if (opts.some((o) => bytes(o) === 0)) problems.push("Options cannot be empty.");
  if (opts.some((o) => bytes(o) > MAX_OPTION_BYTES)) problems.push(`Each option must be ${MAX_OPTION_BYTES} bytes or fewer.`);
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) problems.push("Options must be different.");
  if (!Number.isInteger(durationSeconds) || durationSeconds < MIN_DURATION || durationSeconds > MAX_DURATION) {
    problems.push("Voting must stay open between 10 minutes and 90 days.");
  }
  return problems;
}

export function viewOf(poll: Poll, nowSeconds: number): PollView {
  const voters = Number(poll.voters);
  const percent = poll.tally.map((t) => (voters === 0 ? 0 : Math.round((Number(t) * 1000) / voters) / 10));
  let leader: number | null = null;
  let best = 0n;
  let tie = false;
  poll.tally.forEach((t, i) => {
    if (t > best) {
      best = t;
      leader = i;
      tie = false;
    } else if (t === best && t > 0n) {
      tie = true;
    }
  });
  return { ...poll, open: nowSeconds < poll.closesAt, percent, leader: tie ? null : leader };
}

type PollTuple = readonly [Address, bigint, bigint, string, readonly string[], readonly bigint[], bigint];

export function pollFromTuple(id: bigint, t: PollTuple): Poll {
  return {
    id,
    creator: t[0],
    creatorHuman: t[1],
    closesAt: Number(t[2]),
    question: t[3],
    options: [...t[4]],
    tally: [...t[5]],
    voters: t[6],
  };
}

/** The newest `limit` polls, newest first. */
export async function readPolls(client: Pick<PublicClient, "readContract">, address: Address, limit = 20): Promise<Poll[]> {
  const count = (await client.readContract({ address, abi: humanPollAbi, functionName: "pollCount" })) as bigint;
  const ids: bigint[] = [];
  for (let id = count - 1n; id >= 0n && ids.length < limit; id -= 1n) ids.push(id);
  return Promise.all(
    ids.map(async (id) =>
      pollFromTuple(id, (await client.readContract({ address, abi: humanPollAbi, functionName: "getPoll", args: [id] })) as PollTuple),
    ),
  );
}

/** Which option `human` chose in each poll (index), or null. */
export async function readBallots(
  client: Pick<PublicClient, "readContract">,
  address: Address,
  human: bigint,
  ids: bigint[],
): Promise<Map<bigint, number | null>> {
  const out = new Map<bigint, number | null>();
  if (human === 0n) return out;
  await Promise.all(
    ids.map(async (id) => {
      const b = (await client.readContract({ address, abi: humanPollAbi, functionName: "ballotOf", args: [id, human] })) as bigint;
      out.set(id, b === 0n ? null : Number(b - 1n));
    }),
  );
  return out;
}
