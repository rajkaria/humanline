"use client";

import { CoinsIcon } from "lucide-react";
import { useReadContracts } from "wagmi";

import { HashLink } from "@/components/hash-link";
import { Stat } from "@/components/stat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { relayRewardAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import { formatCount, formatCtc, formatDuration } from "@/lib/format";

/**
 * The RelayReward vault, read live: what a relayer earns, what the vault can still pay,
 * and what it has paid. Renders nothing when no vault is deployed.
 */
export function RelayRewardCard() {
  const vault = CONTRACTS.relayReward.address;
  const reads = useReadContracts({
    contracts: vault
      ? ([
          { address: vault, abi: relayRewardAbi, functionName: "REWARD_PER_ROOT", chainId: creditcoinTestnet.id },
          { address: vault, abi: relayRewardAbi, functionName: "available", chainId: creditcoinTestnet.id },
          { address: vault, abi: relayRewardAbi, functionName: "rootsRewarded", chainId: creditcoinTestnet.id },
          { address: vault, abi: relayRewardAbi, functionName: "totalRewarded", chainId: creditcoinTestnet.id },
          { address: vault, abi: relayRewardAbi, functionName: "MAX_ROOT_AGE", chainId: creditcoinTestnet.id },
        ] as const)
      : [],
    query: { enabled: Boolean(vault), refetchInterval: 30_000 },
  });
  if (!vault) return null;

  const value = (i: number) => {
    const entry = reads.data?.[i];
    return entry?.status === "success" ? (entry.result as bigint) : undefined;
  };
  const reward = value(0);
  const available = value(1);
  const rootsRewarded = value(2);
  const totalRewarded = value(3);
  const maxAge = value(4);

  return (
    <Card size="sm" data-testid="relay-reward">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CoinsIcon className="size-3.5 text-brand" />
          RelayReward vault
        </CardTitle>
        <CardDescription>
          Anyone who carries a fresh World ID root through{" "}
          <HashLink value={vault} scope="creditcoin" kind="address" copy={false} /> is paid for it. No
          owner: funds only leave as rewards, so no single relayer is load-bearing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Per fresh root" value={reward === undefined ? "—" : `${formatCtc(reward)} tCTC`} emphasis />
          <Stat label="Can still pay" value={available === undefined ? "—" : `${formatCtc(available)} tCTC`} />
          <Stat label="Roots rewarded" value={rootsRewarded === undefined ? "—" : formatCount(rootsRewarded)} />
          <Stat label="Paid out" value={totalRewarded === undefined ? "—" : `${formatCtc(totalRewarded)} tCTC`} />
        </dl>
        <p className="pt-3 text-xs text-muted-foreground">
          Paid only when the call moves Creditcoin&rsquo;s tip to a root younger than{" "}
          {maxAge === undefined ? "the age limit" : formatDuration(maxAge)}, at most 10 roots per call; a
          root can be relayed once, so the same work is never paid twice.
        </p>
      </CardContent>
    </Card>
  );
}
