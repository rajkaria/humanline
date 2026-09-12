"use client";

import { useReadContracts } from "wagmi";

import {
  attestedWorldIdAbi,
  creditLineAbi,
  humanRegistryAbi,
} from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";

export type ProtocolStats = {
  /** Roots relayed from Ethereum mainnet (Attestcoin chainKey 3). */
  rootsMainnet?: bigint;
  /** Roots relayed from Ethereum Sepolia (Attestcoin chainKey 1). */
  rootsSepolia?: bigint;
  /** World ID identity commitments added across all relayed mainnet roots. */
  humansInTreeMainnet?: bigint;
  /** Humans who have bound a nullifier to a Creditcoin wallet. */
  humanCount?: bigint;
  /** Principal currently outstanding across every line, in hUSD base units. */
  totalBorrowed?: bigint;
  /** Assets the lender pool holds, in hUSD base units. */
  totalAssets?: bigint;
};

/**
 * The four numbers the landing page and the relay header both need.
 *
 * Reads are batched into a single multicall-free `eth_call` burst by viem's
 * batching transport. Contracts that have no address yet are simply omitted, so
 * a partial deployment still renders the counters it can.
 */
export function useProtocolStats(options: { refetchInterval?: number } = {}) {
  const mainnet = CONTRACTS.attestedWorldIDMainnet.address;
  const sepolia = CONTRACTS.attestedWorldIDSepolia.address;
  const registry = CONTRACTS.humanRegistry.address;
  const creditLine = CONTRACTS.creditLine.address;

  const contracts = [
    mainnet && {
      address: mainnet,
      abi: attestedWorldIdAbi,
      functionName: "rootCount",
      chainId: creditcoinTestnet.id,
    },
    mainnet && {
      address: mainnet,
      abi: attestedWorldIdAbi,
      functionName: "humansAddedTotal",
      chainId: creditcoinTestnet.id,
    },
    sepolia && {
      address: sepolia,
      abi: attestedWorldIdAbi,
      functionName: "rootCount",
      chainId: creditcoinTestnet.id,
    },
    registry && {
      address: registry,
      abi: humanRegistryAbi,
      functionName: "humanCount",
      chainId: creditcoinTestnet.id,
    },
    creditLine && {
      address: creditLine,
      abi: creditLineAbi,
      functionName: "totalBorrowed",
      chainId: creditcoinTestnet.id,
    },
    creditLine && {
      address: creditLine,
      abi: creditLineAbi,
      functionName: "totalAssets",
      chainId: creditcoinTestnet.id,
    },
  ].filter(Boolean) as Array<{
    address: `0x${string}`;
    abi: unknown;
    functionName: string;
    chainId: number;
  }>;

  const query = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ABIs are heterogeneous; each read is narrowed below.
    contracts: contracts as any,
    query: {
      enabled: contracts.length > 0,
      refetchInterval: options.refetchInterval,
    },
  });

  // Walk the results in the same order the request was built, skipping the
  // entries that were dropped because their contract has no address.
  const stats: ProtocolStats = {};
  let cursor = 0;
  const next = (): bigint | undefined => {
    const entry = query.data?.[cursor++];
    return entry && entry.status === "success" ? (entry.result as bigint) : undefined;
  };

  if (mainnet) {
    stats.rootsMainnet = next();
    stats.humansInTreeMainnet = next();
  }
  if (sepolia) stats.rootsSepolia = next();
  if (registry) stats.humanCount = next();
  if (creditLine) {
    stats.totalBorrowed = next();
    stats.totalAssets = next();
  }

  return {
    stats,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    /** `true` when nothing is deployed and there is nothing to read. */
    unavailable: contracts.length === 0,
  };
}
