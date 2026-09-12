"use client";

import type { PublicClient } from "viem";

import { deploymentBlockOf, deploymentTxHashOf, type ContractKey } from "@/lib/contracts";

/**
 * Resolve the block a contract was deployed in, for use as a `getLogs` floor.
 *
 * The deployments file records a wall-clock `deployedAt`, not a block height —
 * but it does record the deploy transaction hash, and a receipt pins the block
 * exactly. Looking that up once turns a scan from genesis into a scan over the
 * handful of blocks that can actually contain the contract's logs.
 *
 * Cached per contract for the life of the tab; a deploy block never changes.
 * Falls back to whatever `deploymentBlockOf` knows (an explicit
 * `NEXT_PUBLIC_DEPLOYMENT_BLOCK`, or 0) when there is no hash or the lookup
 * fails.
 */
const cache = new Map<ContractKey, bigint>();

export async function resolveDeploymentBlock(
  client: PublicClient,
  key: ContractKey,
): Promise<bigint> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const declared = deploymentBlockOf(key);
  if (declared > 0n) {
    cache.set(key, declared);
    return declared;
  }

  const hash = deploymentTxHashOf(key);
  if (hash) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.blockNumber !== null && receipt.blockNumber !== undefined) {
        cache.set(key, receipt.blockNumber);
        return receipt.blockNumber;
      }
    } catch {
      // A pruned receipt or an unreachable RPC just means we scan wider.
    }
  }

  cache.set(key, declared);
  return declared;
}
