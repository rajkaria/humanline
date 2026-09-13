"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useReadContracts } from "wagmi";

import { Progress } from "@/components/ui/progress";
import { creditLineAbi } from "@/lib/abi";
import { creditcoinTestnet, SOURCE_CHAINS, type SourceChainKey } from "@/lib/chains";
import { formatCount, formatCtc, formatRatio, formatUsd } from "@/lib/format";

/**
 * The pool's security budget, live from AttestorStash `0x0FD4` through `CreditLine`:
 * how many attestors are bonded for the World ID source chain, their minimum bond,
 * and the ceiling on total outstanding credit that follows from it.
 *
 * Renders nothing against a credit line that predates the cap, so an old deployment
 * degrades to the pool stats it already had.
 */
export function SecurityBudget({ creditLine, symbol }: { creditLine: `0x${string}`; symbol: string }) {
  const reads = useReadContracts({
    contracts: [
      { address: creditLine, abi: creditLineAbi, functionName: "securityBudget", chainId: creditcoinTestnet.id },
      { address: creditLine, abi: creditLineAbi, functionName: "totalBorrowed", chainId: creditcoinTestnet.id },
      { address: creditLine, abi: creditLineAbi, functionName: "SECURITY_CHAIN_KEY", chainId: creditcoinTestnet.id },
      { address: creditLine, abi: creditLineAbi, functionName: "EXPOSURE_PER_BONDED_CTC", chainId: creditcoinTestnet.id },
    ] as const,
    query: { refetchInterval: 30_000 },
  });

  const budget = reads.data?.[0];
  if (!budget || budget.status !== "success") return null;
  const [attestors, minBond, cap] = budget.result as readonly [number, bigint, bigint];
  const borrowed = reads.data?.[1]?.status === "success" ? (reads.data[1].result as bigint) : 0n;
  const chainKey = reads.data?.[2]?.status === "success" ? Number(reads.data[2].result) : undefined;
  const rate = reads.data?.[3]?.status === "success" ? (reads.data[3].result as bigint) : undefined;
  const chain = chainKey === 1 || chainKey === 3 ? SOURCE_CHAINS[chainKey as SourceChainKey] : undefined;
  const bonded = BigInt(attestors) * minBond;
  const used = cap === 0n ? 100 : Number((borrowed * 100n) / cap);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-2/25 bg-brand-2/5 p-3" data-testid="security-budget">
      <p className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheckIcon className="size-4 text-brand-2" aria-hidden />
        Security budget: {formatUsd(cap)} {symbol}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Every loan here rests on roots Attestcoin&rsquo;s attestors vouched for
        {chain ? ` on ${chain.name}` : ""}. So the pool never lends more in total than they have at
        stake: {formatCount(attestors)} bonded attestors × {formatCtc(minBond)} CTC minimum bond ={" "}
        {formatCtc(bonded)} CTC, at {rate === undefined ? "–" : formatUsd(rate)} {symbol} per bonded CTC.
        Read live from AttestorStash <code className="font-mono text-[11px]">0x0FD4</code> on every draw.
      </p>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Lent out against the budget</span>
        <span className="font-mono tabular-nums">{formatRatio(borrowed, cap === 0n ? 1n : cap)}</span>
      </div>
      <Progress value={Math.min(100, used)} aria-label="Outstanding credit against the security budget" />
    </div>
  );
}
