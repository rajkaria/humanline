/**
 * A loan-lifecycle feed a credit bureau or a Credal-style consumer can ingest: every line opened,
 * drawn, repaid, re-priced and written off, keyed by the human (World ID nullifier) rather than by
 * wallet, newest first. Built from `CreditLine` events only, so anyone can rebuild it from the chain.
 */

import type { Address, Hex, PublicClient } from "viem";

import { creditLineAbi } from "@/lib/abi";

export const FEED_EVENTS = ["LineOpened", "Borrowed", "Repaid", "LimitChanged", "Defaulted"] as const;
export type FeedEventName = (typeof FEED_EVENTS)[number];

export type FeedItem = {
  /** Stable id: `txHash:logIndex`. */
  id: string;
  type: "line.opened" | "loan.drawn" | "loan.repaid" | "limit.changed" | "loan.defaulted";
  human: Hex;
  wallet: Address | null;
  block: number;
  txHash: Hex;
  logIndex: number;
  /** hUSD base units (6 decimals) as decimal strings, per event type. */
  data: Record<string, string | number | boolean>;
};

type DecodedLog = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
};

const hex32 = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));

export function feedItemOf(log: DecodedLog): FeedItem | null {
  const a = log.args;
  const base = {
    id: `${log.transactionHash}:${log.logIndex}`,
    human: hex32(a.human as bigint),
    block: Number(log.blockNumber ?? 0n),
    txHash: (log.transactionHash ?? "0x") as Hex,
    logIndex: log.logIndex ?? 0,
  };
  switch (log.eventName) {
    case "LineOpened":
      return { ...base, type: "line.opened", wallet: a.wallet as Address, data: { limit: str(a.limit) } };
    case "Borrowed":
      return {
        ...base,
        type: "loan.drawn",
        wallet: a.wallet as Address,
        data: { amount: str(a.amount), fee: str(a.fee), dueAt: Number(a.dueAt as bigint) },
      };
    case "Repaid":
      return { ...base, type: "loan.repaid", wallet: a.wallet as Address, data: { amount: str(a.amount), remaining: str(a.remaining) } };
    case "LimitChanged":
      return {
        ...base,
        type: "limit.changed",
        wallet: null,
        data: { oldLimit: str(a.oldLimit), newLimit: str(a.newLimit), onTime: Boolean(a.onTime) },
      };
    case "Defaulted":
      return { ...base, type: "loan.defaulted", wallet: null, data: { writtenOff: str(a.writtenOff), reporter: str(a.reporter) } };
    default:
      return null;
  }
}

/** Newest first, stable within a block. */
export function sortFeed(items: FeedItem[]): FeedItem[] {
  return [...items].sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
}

const WINDOW = 5_000n;

export async function readFeed(
  client: Pick<PublicClient, "getBlockNumber" | "getContractEvents">,
  creditLine: Address,
  fromBlock: bigint,
  { limit = 200, human }: { limit?: number; human?: bigint } = {},
): Promise<{ items: FeedItem[]; fromBlock: number; toBlock: number }> {
  const head = await client.getBlockNumber();
  const items: FeedItem[] = [];
  for (let end = head; end >= fromBlock && items.length < limit; end -= WINDOW) {
    const start = end - WINDOW + 1n > fromBlock ? end - WINDOW + 1n : fromBlock;
    const logs = (await client.getContractEvents({
      address: creditLine,
      abi: creditLineAbi,
      fromBlock: start,
      toBlock: end,
    })) as unknown as DecodedLog[];
    for (const log of logs) {
      if (!(FEED_EVENTS as readonly string[]).includes(log.eventName)) continue;
      if (human !== undefined && (log.args.human as bigint) !== human) continue;
      const item = feedItemOf(log);
      if (item) items.push(item);
    }
    if (start === fromBlock) break;
  }
  return { items: sortFeed(items).slice(0, limit), fromBlock: Number(fromBlock), toBlock: Number(head) };
}
