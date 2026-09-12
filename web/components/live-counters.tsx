"use client";

import { BanknoteIcon, GitBranchIcon, LayersIcon, UsersIcon } from "lucide-react";

import { Stat } from "@/components/stat";
import { formatCount, formatUsd } from "@/lib/format";
import { useProtocolStats } from "@/lib/hooks/use-protocol-stats";

const DASH = "—";

/**
 * The four live numbers on the landing page, read straight from CC3.
 *
 * Deliberately shows `—` rather than `0` when a contract is not deployed: a
 * zero that is really "we could not read it" is the kind of thing that makes a
 * judge stop trusting the rest of the page.
 */
export function LiveCounters() {
  const { stats, isLoading, unavailable } = useProtocolStats({ refetchInterval: 30_000 });

  const show = (value: bigint | undefined) =>
    value === undefined ? DASH : formatCount(value);

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Roots relayed · Ethereum"
        icon={<GitBranchIcon className="size-3.5" />}
        value={show(stats.rootsMainnet)}
        hint={
          stats.humansInTreeMainnet === undefined
            ? "World's Orb tree, chainKey 3"
            : `${formatCount(stats.humansInTreeMainnet)} identity commitments carried`
        }
        loading={isLoading && !unavailable}
        emphasis
      />
      <Stat
        label="Roots relayed · Sepolia"
        icon={<LayersIcon className="size-3.5" />}
        value={show(stats.rootsSepolia)}
        hint="Staging tree, chainKey 1"
        loading={isLoading && !unavailable}
      />
      <Stat
        label="Humans registered"
        icon={<UsersIcon className="size-3.5" />}
        value={show(stats.humanCount)}
        hint="One nullifier, one wallet binding"
        loading={isLoading && !unavailable}
      />
      <Stat
        label="Credit outstanding"
        icon={<BanknoteIcon className="size-3.5" />}
        value={stats.totalBorrowed === undefined ? DASH : formatUsd(stats.totalBorrowed)}
        hint={
          stats.totalAssets === undefined
            ? "hUSD principal, uncollateralised"
            : `of ${formatUsd(stats.totalAssets)} hUSD in the pool`
        }
        loading={isLoading && !unavailable}
      />
    </dl>
  );
}
