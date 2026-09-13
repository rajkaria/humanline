import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";

import { feedItemOf, readFeed, sortFeed } from "@/lib/feed";

const HUMAN = 0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4n;
const WALLET = "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3";
const TX = `0x${"ab".repeat(32)}` as Hex;

const log = (eventName: string, args: Record<string, unknown>, block = 10n, logIndex = 0) => ({
  eventName,
  args: { human: HUMAN, ...args },
  blockNumber: block,
  transactionHash: TX,
  logIndex,
});

describe("feedItemOf", () => {
  test("maps each lifecycle event to a typed item keyed by the human", () => {
    expect(feedItemOf(log("LineOpened", { wallet: WALLET, limit: 25_000_000n }))).toEqual({
      id: `${TX}:0`,
      type: "line.opened",
      human: "0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4",
      wallet: WALLET,
      block: 10,
      txHash: TX,
      logIndex: 0,
      data: { limit: "25000000" },
    });
    expect(feedItemOf(log("Borrowed", { wallet: WALLET, amount: 10_000_000n, fee: 100_000n, dueAt: 1_789_000_000n }))?.data).toEqual({
      amount: "10000000",
      fee: "100000",
      dueAt: 1_789_000_000,
    });
    expect(feedItemOf(log("Repaid", { wallet: WALLET, amount: 5n, remaining: 0n }))?.type).toBe("loan.repaid");
    expect(feedItemOf(log("LimitChanged", { oldLimit: 25n, newLimit: 31n, onTime: true }))).toMatchObject({
      type: "limit.changed",
      wallet: null,
      data: { oldLimit: "25", newLimit: "31", onTime: true },
    });
    expect(feedItemOf(log("Defaulted", { writtenOff: 9n, reporter: WALLET }))?.data).toEqual({ writtenOff: "9", reporter: WALLET });
  });

  test("ignores events that are not part of a loan's life", () => {
    expect(feedItemOf(log("Deposited", { lender: WALLET }))).toBeNull();
  });
});

describe("readFeed", () => {
  test("scans backwards in windows, filters by human, sorts newest first and stops at the limit", async () => {
    const other = 99n;
    const windows: Array<[bigint, bigint]> = [];
    const client = {
      getBlockNumber: async () => 12_000n,
      getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        windows.push([fromBlock, toBlock]);
        const chain = [
          log("LineOpened", { wallet: WALLET, limit: 1n }, 7_100n, 0),
          { ...log("Borrowed", {}, 7_100n, 3), args: { human: other, wallet: WALLET, amount: 1n, fee: 0n, dueAt: 1n } },
          log("Deposited", { lender: WALLET }, 7_100n, 4),
          log("Repaid", { wallet: WALLET, amount: 1n, remaining: 0n }, 11_000n, 1),
        ];
        return chain.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
    } as never;

    const all = await readFeed(client, WALLET, 1_000n);
    expect(all.items.map((i) => i.type)).toEqual(["loan.repaid", "loan.drawn", "line.opened"]);
    expect(windows[0]).toEqual([7_001n, 12_000n]);
    expect(windows.at(-1)![0]).toBe(1_000n);

    const mine = await readFeed(client, WALLET, 1_000n, { human: HUMAN });
    expect(mine.items.map((i) => i.type)).toEqual(["loan.repaid", "line.opened"]);

    const one = await readFeed(client, WALLET, 1_000n, { limit: 1 });
    expect(one.items).toHaveLength(1);
    expect(one.toBlock).toBe(12_000);
  });

  test("sortFeed orders by block then log index, descending", () => {
    const a = feedItemOf(log("Repaid", { wallet: WALLET, amount: 1n, remaining: 0n }, 5n, 1))!;
    const b = feedItemOf(log("Repaid", { wallet: WALLET, amount: 1n, remaining: 0n }, 5n, 2))!;
    const c = feedItemOf(log("Repaid", { wallet: WALLET, amount: 1n, remaining: 0n }, 6n, 0))!;
    expect(sortFeed([a, b, c]).map((x) => x.id.split(":")[1] + "@" + x.block)).toEqual(["0@6", "2@5", "1@5"]);
  });
});
