"use client";

import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type AbiEvent } from "viem";

import { creditLineAbi } from "@/lib/abi";
import { useProfile } from "@/lib/profile-context";
import { resolveDeploymentBlock } from "@/lib/hooks/use-deployment-block";
import { scanLogs } from "@/lib/logs";
import { getPublicClient } from "@/lib/public-client";

export type LineEventKind =
  | "LineOpened"
  | "Borrowed"
  | "Repaid"
  | "LimitChanged"
  | "Defaulted";

export type LineEvent = {
  kind: LineEventKind;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  /** Rendered in the "detail" column. */
  detail: string;
  /** Primary amount in hUSD base units, when the event has one. */
  amount?: bigint;
  timestamp?: bigint;
};

/** How far back to look when the deployment block cannot be resolved. */
const LOOKBACK = 2_000_000n;

const EVENTS: LineEventKind[] = [
  "LineOpened",
  "Borrowed",
  "Repaid",
  "LimitChanged",
  "Defaulted",
];

/**
 * Every `CreditLine` event for one human, newest first.
 *
 * Filtered on the indexed `human` topic so a wallet only ever downloads its own
 * history, and each event is resolved to the block timestamp so the table can
 * show "4m ago" rather than a bare block number.
 */
export function useLineEvents(human: bigint, options: { limit?: number } = {}) {
  const limit = options.limit ?? 25;
  const { profile } = useProfile();
  const creditLineContract = profile.deployment.contracts.creditLine;
  const creditLine = creditLineContract.address;

  return useQuery({
    queryKey: ["line-events", creditLine, human.toString(), limit],
    enabled: Boolean(creditLine) && human > 0n,
    refetchInterval: 20_000,
    queryFn: async (): Promise<LineEvent[]> => {
      if (!creditLine || human === 0n) return [];
      const client = getPublicClient();
      const [tip, floor] = await Promise.all([
        client.getBlockNumber(),
        resolveDeploymentBlock(client, creditLineContract),
      ]);
      // A bounded look-back when the deployment block is unknown: five event
      // types on a 20s timer must never turn into five full-chain rescans.
      const from = floor.exact ? floor.block : tip > LOOKBACK ? tip - LOOKBACK : 0n;

      const batches = await Promise.all(
        EVENTS.map(async (kind) => {
          const event = getAbiItem({ abi: creditLineAbi, name: kind }) as AbiEvent;
          const scan = await scanLogs({
            client,
            address: creditLine,
            event,
            args: { human },
            fromBlock: from,
            toBlock: tip,
            limit,
          });
          return scan.logs.map((log) => toLineEvent(kind, log));
        }),
      );

      const merged = batches
        .flat()
        .sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? b.logIndex - a.logIndex
            : a.blockNumber < b.blockNumber
              ? 1
              : -1,
        )
        .slice(0, limit);

      // Resolve timestamps for the blocks actually on screen, de-duplicated.
      const blocks = [...new Set(merged.map((e) => e.blockNumber))];
      const timestamps = new Map<bigint, bigint>();
      await Promise.all(
        blocks.map(async (blockNumber) => {
          try {
            const block = await client.getBlock({ blockNumber });
            timestamps.set(blockNumber, block.timestamp);
          } catch {
            // A pruned or unavailable block just loses its relative time.
          }
        }),
      );

      return merged.map((e) => ({ ...e, timestamp: timestamps.get(e.blockNumber) }));
    },
  });
}

type RawLog = {
  transactionHash: `0x${string}` | null;
  blockNumber: bigint | null;
  logIndex: number | null;
  args?: Record<string, unknown>;
};

function toLineEvent(kind: LineEventKind, log: unknown): LineEvent {
  const raw = log as RawLog;
  const args = (raw.args ?? {}) as Record<string, bigint | string | boolean | undefined>;

  const base = {
    kind,
    txHash: (raw.transactionHash ?? "0x") as `0x${string}`,
    blockNumber: raw.blockNumber ?? 0n,
    logIndex: raw.logIndex ?? 0,
  };

  switch (kind) {
    case "LineOpened":
      return { ...base, detail: "Line opened", amount: args.limit as bigint };
    case "Borrowed":
      return {
        ...base,
        detail: `Fee ${args.fee as bigint}`,
        amount: args.amount as bigint,
      };
    case "Repaid":
      return {
        ...base,
        detail: `${args.remaining as bigint} remaining`,
        amount: args.amount as bigint,
      };
    case "LimitChanged":
      return {
        ...base,
        detail: (args.onTime as boolean) ? "Repaid on time" : "Repaid late",
        amount: args.newLimit as bigint,
      };
    case "Defaulted":
      return { ...base, detail: "Written off", amount: args.writtenOff as bigint };
  }
}
