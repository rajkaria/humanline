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
export type DeploymentFloor = {
  block: bigint;
  /** `true` when this really is the deployment block, not a fallback. */
  exact: boolean;
};

const cache = new Map<ContractKey, DeploymentFloor>();

export async function resolveDeploymentBlock(
  client: PublicClient,
  key: ContractKey,
): Promise<DeploymentFloor> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const declared = deploymentBlockOf(key);
  if (declared > 0n) {
    const floor = { block: declared, exact: true };
    cache.set(key, floor);
    return floor;
  }

  const hash = deploymentTxHashOf(key);
  if (hash) {
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.blockNumber !== null && receipt.blockNumber !== undefined) {
        const floor = { block: receipt.blockNumber, exact: true };
        cache.set(key, floor);
        return floor;
      }
    } catch {
      // A pruned receipt or an unreachable RPC just means we scan a bounded
      // look-back instead, and the caller labels the table accordingly.
    }
  }

  // Not cached: a later call may well reach the RPC and get the real block.
  return { block: 0n, exact: false };
}
