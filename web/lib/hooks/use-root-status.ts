"use client";

import { useReadContract, useReadContracts } from "wagmi";

import { attestedWorldIdAbi } from "@/lib/abi";
import { creditcoinTestnet } from "@/lib/chains";
import { useProfile } from "@/lib/profile-context";

/**
 * Is the Merkle root behind this proof already on Creditcoin?
 *
 * World App issues a proof against whatever root the identity tree has *right now*.
 * Creditcoin only knows the roots the relayer has carried across, so a proof minted
 * between two relay runs is valid everywhere except here, and `register` would revert
 * with `UnknownRoot` after the user has already paid gas.
 *
 * Asking the AttestedWorldID instance first turns that into a sentence the user can
 * act on ("wait for the next relay, or relay it yourself") instead of a failed
 * transaction — and it is the same `isValidRoot` the registry itself calls.
 */
export function useRootStatus(root: bigint | undefined) {
  const { profile } = useProfile();
  const attested = profile.deployment.contracts[profile.worldIdKey].address;
  const enabled = Boolean(attested);

  const reads = useReadContracts({
    contracts: attested
      ? ([
          {
            address: attested,
            abi: attestedWorldIdAbi,
            functionName: "latestRoot",
            chainId: creditcoinTestnet.id,
          },
          {
            address: attested,
            abi: attestedWorldIdAbi,
            functionName: "rootCount",
            chainId: creditcoinTestnet.id,
          },
        ] as const)
      : [],
    query: { enabled, refetchInterval: 20_000 },
  });

  const known = useReadContract({
    address: attested,
    abi: attestedWorldIdAbi,
    functionName: "isValidRoot",
    args: [root ?? 0n],
    chainId: creditcoinTestnet.id,
    query: { enabled: enabled && root !== undefined && root > 0n, refetchInterval: 20_000 },
  });

  const value = <T,>(index: number): T | undefined => {
    const entry = reads.data?.[index];
    return entry && entry.status === "success" ? (entry.result as T) : undefined;
  };

  return {
    attested,
    latestRoot: value<bigint>(0),
    rootCount: value<bigint>(1),
    /** `undefined` while unknown — never render "unknown root" on a pending read. */
    rootIsKnown:
      root !== undefined && root > 0n && known.isSuccess ? (known.data as boolean) : undefined,
    isLoading: reads.isLoading || known.isLoading,
    /** A background poll or manual refetch is in flight. */
    isFetching: reads.isFetching || known.isFetching,
    refetch: async () => {
      await Promise.all([reads.refetch(), known.refetch()]);
    },
  };
}
