"use client";

import { useAccount, useReadContracts } from "wagmi";

import { humanRegistryAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { useProfile } from "@/lib/profile-context";

export type HumanState = {
  /** The connected wallet is bound to a World ID nullifier. */
  isHuman: boolean;
  /** The nullifier itself. `0n` when the wallet is not registered. */
  nullifierHash: bigint;
  /** Unix seconds the human first registered, across any wallet. */
  registeredAt: bigint;
  /** The wallet the nullifier currently points at (same as the connected one). */
  boundWallet?: `0x${string}`;
  /** Total humans registered. */
  humanCount?: bigint;
  /** The action string the registry pins its external nullifier to. */
  action?: string;
  /** The app id the registry pins its external nullifier to. */
  appId?: string;
  /** `externalNullifierHash` as the contract computed it, for the `/judge` check. */
  externalNullifierHash?: bigint;
};

/**
 * Everything `/app` needs to know about the connected wallet's personhood.
 *
 * Deliberately reads `registeredAt` and `walletOf` too: a human who re-bound to
 * a new wallet should see the original registration date and understand that the
 * history moved with them, which is the whole product claim.
 */
export function useHuman() {
  const { address } = useAccount();
  const { profile } = useProfile();
  const registry = profile.deployment.contracts.humanRegistry.address;
  const enabled = Boolean(registry && address);

  const base = useReadContracts({
    contracts:
      registry && address
        ? ([
            {
              address: registry,
              abi: humanRegistryAbi,
              functionName: "humanOf",
              args: [address],
              chainId: creditcoinTestnet.id,
            },
            {
              address: registry,
              abi: humanRegistryAbi,
              functionName: "humanCount",
              chainId: creditcoinTestnet.id,
            },
            {
              address: registry,
              abi: humanRegistryAbi,
              functionName: "ACTION",
              chainId: creditcoinTestnet.id,
            },
            {
              address: registry,
              abi: humanRegistryAbi,
              functionName: "APP_ID",
              chainId: creditcoinTestnet.id,
            },
            {
              address: registry,
              abi: humanRegistryAbi,
              functionName: "EXTERNAL_NULLIFIER_HASH",
              chainId: creditcoinTestnet.id,
            },
          ] as const)
        : [],
    query: { enabled, refetchInterval: 15_000 },
  });

  const nullifierHash =
    base.data?.[0]?.status === "success" ? (base.data[0].result as bigint) : 0n;

  const detail = useReadContracts({
    contracts:
      registry && nullifierHash > 0n
        ? ([
            {
              address: registry,
              abi: humanRegistryAbi,
              functionName: "registeredAt",
              args: [nullifierHash],
              chainId: creditcoinTestnet.id,
            },
            {
              address: registry,
              abi: humanRegistryAbi,
              functionName: "walletOf",
              args: [nullifierHash],
              chainId: creditcoinTestnet.id,
            },
          ] as const)
        : [],
    query: { enabled: Boolean(registry) && nullifierHash > 0n },
  });

  const pick = <T,>(
    data: typeof base.data | typeof detail.data,
    index: number,
  ): T | undefined => {
    const entry = data?.[index];
    return entry && entry.status === "success" ? (entry.result as T) : undefined;
  };

  const state: HumanState = {
    isHuman: nullifierHash > 0n,
    nullifierHash,
    registeredAt: pick<bigint>(detail.data, 0) ?? 0n,
    boundWallet: pick<`0x${string}`>(detail.data, 1),
    humanCount: pick<bigint>(base.data, 1),
    action: pick<string>(base.data, 2),
    appId: pick<string>(base.data, 3),
    externalNullifierHash: pick<bigint>(base.data, 4),
  };

  return {
    ...state,
    address,
    isLoading: base.isLoading || (nullifierHash > 0n && detail.isLoading),
    isFetching: base.isFetching,
    error: base.error ?? detail.error,
    deployed: Boolean(registry),
    refetch: async () => {
      await base.refetch();
      await detail.refetch();
    },
  };
}
