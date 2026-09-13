"use client";

import type { Address } from "viem";
import { useReadContracts } from "wagmi";

import { creditHistoryAbi, ethRepayAbi, humanLinksAbi, humanRegistryAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { useProfile } from "@/lib/profile-context";

const chainId = creditcoinTestnet.id;

/**
 * Everything the cross-chain panel shows, in one batched read: the human's linked wallets, their
 * proved Aave record and boost, and the Ethereum repayment terms.
 */
export function useCrossChain(human: bigint) {
  const { profile } = useProfile();
  const c = profile.deployment.contracts;
  const links = c.humanLinks.address;
  const history = c.creditHistory.address;
  const repay = c.ethRepay.address;
  const registry = c.humanRegistry.address;
  const deployed = Boolean(links && history && repay && registry);

  const reads = useReadContracts({
    contracts: deployed
      ? ([
          { address: links!, abi: humanLinksAbi, functionName: "linksOf", args: [human], chainId },
          { address: links!, abi: humanLinksAbi, functionName: "MAX_LINKS", chainId },
          { address: history!, abi: creditHistoryAbi, functionName: "repaidUsdOf", args: [human], chainId },
          { address: history!, abi: creditHistoryAbi, functionName: "repaymentsOf", args: [human], chainId },
          { address: history!, abi: creditHistoryAbi, functionName: "boostOf", args: [human], chainId },
          { address: history!, abi: creditHistoryAbi, functionName: "MIN_GAP_BLOCKS", chainId },
          { address: history!, abi: creditHistoryAbi, functionName: "BOOST_BPS", chainId },
          { address: history!, abi: creditHistoryAbi, functionName: "MAX_BOOST", chainId },
          { address: repay!, abi: ethRepayAbi, functionName: "REPAY_ADDRESS", chainId },
          { address: repay!, abi: ethRepayAbi, functionName: "reserve", chainId },
          { address: repay!, abi: ethRepayAbi, functionName: "overpaidOf", args: [human], chainId },
          { address: registry!, abi: humanRegistryAbi, functionName: "walletOf", args: [human], chainId },
        ] as const)
      : [],
    query: { enabled: deployed && human > 0n, refetchInterval: 30_000 },
  });

  const at = <T,>(i: number): T | undefined =>
    reads.data?.[i]?.status === "success" ? (reads.data[i]!.result as T) : undefined;

  return {
    deployed,
    links,
    history,
    repay,
    linked: at<readonly Address[]>(0) ?? [],
    maxLinks: at<bigint>(1),
    repaidUsd: at<bigint>(2),
    repayments: at<number>(3),
    boost: at<bigint>(4),
    minGapBlocks: at<bigint>(5),
    boostBps: at<bigint>(6),
    maxBoost: at<bigint>(7),
    repayAddress: at<Address>(8),
    reserve: at<bigint>(9),
    overpaid: at<bigint>(10),
    humanWallet: at<Address>(11),
    isLoading: reads.isLoading,
    refetch: reads.refetch,
  };
}
