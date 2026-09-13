"use client";

import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { creditcoinTestnet } from "@/lib/chains";
import { formatCount, formatUsd } from "@/lib/format";
import { useProtocolStats } from "@/lib/hooks/use-protocol-stats";
import { cn } from "@/lib/utils";

const DASH = "–";

/**
 * The hero's live readout: four numbers pulled straight from CC3, refreshed
 * while the page is open.
 *
 * A dash rather than a zero whenever a read fails — a zero that really means
 * "we could not reach the chain" is exactly the kind of thing that makes a
 * reader stop believing the rest of the page.
 */
export function LivePanel({ className }: { className?: string }) {
  const { stats, isLoading, unavailable } = useProtocolStats({ refetchInterval: 30_000 });
  const loading = isLoading && !unavailable;

  const roots =
    stats.rootsMainnet === undefined && stats.rootsSepolia === undefined
      ? undefined
      : (stats.rootsMainnet ?? 0n) + (stats.rootsSepolia ?? 0n);

  const items = [
    {
      label: "Roots relayed",
      value: roots === undefined ? DASH : formatCount(roots),
      hint:
        stats.rootsMainnet === undefined || stats.rootsSepolia === undefined
          ? "Ethereum mainnet and Sepolia"
          : `${formatCount(stats.rootsMainnet)} mainnet · ${formatCount(stats.rootsSepolia)} Sepolia`,
      emphasis: true,
    },
    {
      label: "Identities carried",
      value:
        stats.humansInTreeMainnet === undefined
          ? DASH
          : formatCount(stats.humansInTreeMainnet),
      hint: "World ID commitments in the relayed roots",
    },
    {
      label: "Humans registered",
      value: stats.humanCount === undefined ? DASH : formatCount(stats.humanCount),
      hint: "One nullifier bound to one wallet",
    },
    {
      label: "In the lender pool",
      value: stats.totalAssets === undefined ? DASH : formatUsd(stats.totalAssets),
      hint:
        stats.totalBorrowed === undefined
          ? "hUSD, uncollateralised"
          : `${formatUsd(stats.totalBorrowed)} hUSD drawn against it`,
    },
  ];

  return (
    <div className={cn("panel p-5 sm:p-6", className)}>
      <div className="flex items-center justify-between gap-3 pb-5">
        <div className="flex items-center gap-2.5">
          <span className="live-dot" aria-hidden />
          <span className="eyebrow text-muted-foreground">
            Live on {creditcoinTestnet.name}
          </span>
        </div>
        <Link
          href="/relay"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-2 transition-opacity hover:opacity-80"
        >
          Relay feed
          <ArrowUpRightIcon className="size-3" aria-hidden />
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-hairline pt-5">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                "font-mono text-[1.7rem] leading-none font-semibold tabular-nums",
                item.emphasis && "text-gradient",
              )}
            >
              {loading ? <Skeleton className="h-7 w-20" /> : item.value}
            </dd>
            <p className="text-xs leading-snug text-muted-foreground/80">{item.hint}</p>
          </div>
        ))}
      </dl>
    </div>
  );
}
