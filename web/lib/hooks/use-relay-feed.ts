"use client";

import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type AbiEvent } from "viem";

import { attestedWorldIdAbi } from "@/lib/abi";
import type { SourceChainKey } from "@/lib/chains";
import { CONTRACTS, WORLD_ID_INSTANCES } from "@/lib/contracts";
import { evidenceFor } from "@/lib/evidence";
import { resolveDeploymentBlock } from "@/lib/hooks/use-deployment-block";
import { scanLogs } from "@/lib/logs";
import { getPublicClient } from "@/lib/public-client";

export type RelayRow = {
  chainKey: SourceChainKey;
  queryId: `0x${string}`;
  sourceBlock: bigint;
  sourceTxIndex: bigint;
  preRoot: bigint;
  postRoot: bigint;
  kind: number;
  humansAdded: number;
  relayer: `0x${string}`;
  /** The Creditcoin transaction that carried the Attestcoin proof. */
  creditcoinTxHash: `0x${string}`;
  creditcoinBlock: bigint;
  logIndex: number;
  timestamp?: bigint;
  /** Recovered from `evidence/relay-log.jsonl` when the worker recorded it. */
  sourceTxHash?: `0x${string}`;
};

const ROOT_RELAYED = getAbiItem({ abi: attestedWorldIdAbi, name: "RootRelayed" }) as AbiEvent;

/**
 * The `RootRelayed` feed across both `AttestedWorldID` instances.
 *
 * Scans newest-first in 50k-block windows from each instance's deployment block
 * and stops as soon as it has `limit` rows, so the page is fast on a chain that
 * has been running for a while. Refreshes on a timer so a judge can watch a real
 * Ethereum root land during the demo.
 */
export function useRelayFeed(options: { limit?: number; refetchInterval?: number } = {}) {
  const limit = options.limit ?? 50;

  const addresses = WORLD_ID_INSTANCES.map((instance) => ({
    chainKey: instance.chainKey,
    contractKey: instance.key,
    address: CONTRACTS[instance.key].address,
  })).filter((i) => Boolean(i.address));

  return useQuery({
    queryKey: [
      "relay-feed",
      addresses.map((a) => `${a.chainKey}:${a.address}`).join(","),
      limit,
    ],
    enabled: addresses.length > 0,
    refetchInterval: options.refetchInterval ?? 15_000,
    queryFn: async (): Promise<RelayRow[]> => {
      const client = getPublicClient();
      const tip = await client.getBlockNumber();

      const batches = await Promise.all(
        addresses.map(async ({ chainKey, contractKey, address }) => {
          const fromBlock = await resolveDeploymentBlock(client, contractKey);
          const logs = await scanLogs({
            client,
            address: address!,
            event: ROOT_RELAYED,
            fromBlock,
            toBlock: tip,
            limit,
          });
          return logs.map((log) => toRelayRow(chainKey, log));
        }),
      );

      const merged = batches
        .flat()
        .sort((a, b) =>
          a.creditcoinBlock === b.creditcoinBlock
            ? b.logIndex - a.logIndex
            : a.creditcoinBlock < b.creditcoinBlock
              ? 1
              : -1,
        )
        .slice(0, limit);

      const blocks = [...new Set(merged.map((r) => r.creditcoinBlock))];
      const timestamps = new Map<bigint, bigint>();
      await Promise.all(
        blocks.map(async (blockNumber) => {
          try {
            const block = await client.getBlock({ blockNumber });
            timestamps.set(blockNumber, block.timestamp);
          } catch {
            // A block we cannot fetch just loses its "4m ago" column.
          }
        }),
      );

      return merged.map((row) => ({
        ...row,
        timestamp: timestamps.get(row.creditcoinBlock),
      }));
    },
  });
}

type RawLog = {
  transactionHash: `0x${string}` | null;
  blockNumber: bigint | null;
  logIndex: number | null;
  args?: Record<string, unknown>;
};

function toRelayRow(chainKey: SourceChainKey, log: unknown): RelayRow {
  const raw = log as RawLog;
  const args = (raw.args ?? {}) as Record<string, unknown>;

  const sourceBlock = BigInt((args.sourceBlock as bigint | undefined) ?? 0n);
  const sourceTxIndex = BigInt((args.sourceTxIndex as bigint | undefined) ?? 0n);
  const postRoot = BigInt((args.postRoot as bigint | undefined) ?? 0n);
  const evidence = evidenceFor(chainKey, sourceBlock, sourceTxIndex, postRoot);

  return {
    chainKey,
    queryId: (args.queryId as `0x${string}`) ?? "0x",
    sourceBlock,
    sourceTxIndex,
    preRoot: BigInt((args.preRoot as bigint | undefined) ?? 0n),
    postRoot,
    kind: Number((args.kind as number | undefined) ?? 0),
    humansAdded: Number((args.humansAdded as number | undefined) ?? 0),
    relayer: (args.relayer as `0x${string}`) ?? "0x",
    creditcoinTxHash: (raw.transactionHash ?? "0x") as `0x${string}`,
    creditcoinBlock: raw.blockNumber ?? 0n,
    logIndex: raw.logIndex ?? 0,
    sourceTxHash: evidence?.sourceTxHash,
  };
}
