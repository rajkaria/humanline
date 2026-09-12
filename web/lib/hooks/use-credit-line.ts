"use client";

import { useAccount, useReadContracts } from "wagmi";

import { creditLineAbi, husdAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";

export type Line = {
  limit: bigint;
  principal: bigint;
  dueAt: bigint;
  openedAt: bigint;
  loansRepaid: number;
  loansLate: number;
  frozen: boolean;
};

export type CreditLineTerms = {
  initialLimit?: bigint;
  maxLimit?: bigint;
  feeBps?: bigint;
  term?: bigint;
  grace?: bigint;
};

export type PoolStats = {
  totalAssets?: bigint;
  totalBorrowed?: bigint;
  totalShares?: bigint;
  shares?: bigint;
};

const EMPTY_LINE: Line = {
  limit: 0n,
  principal: 0n,
  dueAt: 0n,
  openedAt: 0n,
  loansRepaid: 0,
  loansLate: 0,
  frozen: false,
};

/**
 * The credit line, the pool, the terms and the wallet's hUSD position.
 *
 * All of it in one batched read so the panel does not flicker between four
 * independent loading states while a user watches a borrow settle.
 */
export function useCreditLine(human: bigint) {
  const { address } = useAccount();
  const creditLine = CONTRACTS.creditLine.address;
  const husd = CONTRACTS.husd.address;

  const hasLineTarget = Boolean(creditLine) && human > 0n;

  const terms = useReadContracts({
    contracts: creditLine
      ? ([
          { address: creditLine, abi: creditLineAbi, functionName: "INITIAL_LIMIT", chainId: creditcoinTestnet.id },
          { address: creditLine, abi: creditLineAbi, functionName: "MAX_LIMIT", chainId: creditcoinTestnet.id },
          { address: creditLine, abi: creditLineAbi, functionName: "FEE_BPS", chainId: creditcoinTestnet.id },
          { address: creditLine, abi: creditLineAbi, functionName: "TERM", chainId: creditcoinTestnet.id },
          { address: creditLine, abi: creditLineAbi, functionName: "GRACE", chainId: creditcoinTestnet.id },
        ] as const)
      : [],
    // Immutables: read once and keep.
    query: { enabled: Boolean(creditLine), staleTime: Infinity, gcTime: Infinity },
  });

  const pool = useReadContracts({
    contracts:
      creditLine && address
        ? ([
            { address: creditLine, abi: creditLineAbi, functionName: "totalAssets", chainId: creditcoinTestnet.id },
            { address: creditLine, abi: creditLineAbi, functionName: "totalBorrowed", chainId: creditcoinTestnet.id },
            { address: creditLine, abi: creditLineAbi, functionName: "totalShares", chainId: creditcoinTestnet.id },
            { address: creditLine, abi: creditLineAbi, functionName: "sharesOf", args: [address], chainId: creditcoinTestnet.id },
          ] as const)
        : creditLine
          ? ([
              { address: creditLine, abi: creditLineAbi, functionName: "totalAssets", chainId: creditcoinTestnet.id },
              { address: creditLine, abi: creditLineAbi, functionName: "totalBorrowed", chainId: creditcoinTestnet.id },
              { address: creditLine, abi: creditLineAbi, functionName: "totalShares", chainId: creditcoinTestnet.id },
            ] as const)
          : [],
    query: { enabled: Boolean(creditLine), refetchInterval: 15_000 },
  });

  const line = useReadContracts({
    contracts: hasLineTarget
      ? ([
          { address: creditLine!, abi: creditLineAbi, functionName: "lineOf", args: [human], chainId: creditcoinTestnet.id },
          { address: creditLine!, abi: creditLineAbi, functionName: "availableCredit", args: [human], chainId: creditcoinTestnet.id },
          { address: creditLine!, abi: creditLineAbi, functionName: "isInDefault", args: [human], chainId: creditcoinTestnet.id },
        ] as const)
      : [],
    query: { enabled: hasLineTarget, refetchInterval: 10_000 },
  });

  const token = useReadContracts({
    contracts:
      husd && address && creditLine
        ? ([
            { address: husd, abi: husdAbi, functionName: "balanceOf", args: [address], chainId: creditcoinTestnet.id },
            { address: husd, abi: husdAbi, functionName: "allowance", args: [address, creditLine], chainId: creditcoinTestnet.id },
            { address: husd, abi: husdAbi, functionName: "symbol", chainId: creditcoinTestnet.id },
            { address: husd, abi: husdAbi, functionName: "faucetAvailableAt", args: [address], chainId: creditcoinTestnet.id },
            { address: husd, abi: husdAbi, functionName: "FAUCET_AMOUNT", chainId: creditcoinTestnet.id },
          ] as const)
        : [],
    query: { enabled: Boolean(husd && address && creditLine), refetchInterval: 15_000 },
  });

  const ok = <T,>(entry: { status: string; result?: unknown } | undefined): T | undefined =>
    entry && entry.status === "success" ? (entry.result as T) : undefined;

  const rawLine = ok<Line>(line.data?.[0]);

  return {
    line: rawLine ?? EMPTY_LINE,
    /** A line exists once it has been opened — `openedAt` is set at that moment. */
    hasLine: Boolean(rawLine && rawLine.openedAt > 0n),
    available: ok<bigint>(line.data?.[1]) ?? 0n,
    inDefault: ok<boolean>(line.data?.[2]) ?? false,

    terms: {
      initialLimit: ok<bigint>(terms.data?.[0]),
      maxLimit: ok<bigint>(terms.data?.[1]),
      feeBps: ok<bigint>(terms.data?.[2]),
      term: ok<bigint>(terms.data?.[3]),
      grace: ok<bigint>(terms.data?.[4]),
    } satisfies CreditLineTerms,

    pool: {
      totalAssets: ok<bigint>(pool.data?.[0]),
      totalBorrowed: ok<bigint>(pool.data?.[1]),
      totalShares: ok<bigint>(pool.data?.[2]),
      shares: ok<bigint>(pool.data?.[3]),
    } satisfies PoolStats,

    balance: ok<bigint>(token.data?.[0]) ?? 0n,
    allowance: ok<bigint>(token.data?.[1]) ?? 0n,
    symbol: ok<string>(token.data?.[2]) ?? "hUSD",
    /** Unix seconds the connected wallet may next call `faucet()`. */
    faucetAvailableAt: ok<bigint>(token.data?.[3]) ?? 0n,
    faucetAmount: ok<bigint>(token.data?.[4]),

    isLoading: terms.isLoading || pool.isLoading || (hasLineTarget && line.isLoading),
    error: terms.error ?? pool.error ?? line.error ?? token.error,
    deployed: Boolean(creditLine && husd),

    refetch: async () => {
      await Promise.all([pool.refetch(), line.refetch(), token.refetch()]);
    },
  };
}
