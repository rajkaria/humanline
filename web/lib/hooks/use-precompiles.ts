"use client";

import { useQuery } from "@tanstack/react-query";
import { hexToString } from "viem";

import { attestorStashAbi, chainInfoAbi, chainInfoAttestationAbi, chainInfoLookupAbi } from "@/lib/abi";
import { PRECOMPILES, SOURCE_CHAINS, SOURCE_CHAIN_LIST, type SourceChainKey } from "@/lib/chains";
import { getPublicClient } from "@/lib/public-client";

export type PrecompileChainRow = {
  chainKey: number;
  chainId: number;
  chainName: string;
  chainEncoding: number;
  /** Highest attested height (ChainInfo `get_latest_attestation_height_and_hash`). */
  attestedTip?: bigint;
  /** Highest checkpointed height (`get_latest_checkpoint_height_and_hash`, every 100 blocks). */
  checkpointTip?: bigint;
  /** Bonded attestors for the chain (AttestorStash `getAttestorsCount`). */
  attestors?: number;
  /** Minimum bond per attestor, wei of CTC (AttestorStash `getMinBondRequirement`). */
  minBond?: bigint;
  /** `attestors × minBond`: the capital a colluding quorum would put at stake. */
  bondedCapital?: bigint;
  /** `get_chain_by_key(chainKey).chainId` matches the EVM chain Humanline expects for this key. */
  chainIdMatches?: boolean;
};

export type PrecompileSnapshot = {
  chains: PrecompileChainRow[];
  /** `false` when `get_supported_chains` itself failed — not a CC3 node, say. */
  available: boolean;
};

/**
 * Read the Attestcoin precompiles directly, with no wallet: which source chains `0x0FD3`
 * tracks, how far each is attested and checkpointed, whether its chain key really is the
 * EVM chain Humanline assumes, and what `0x0FD4` says its attestors have bonded.
 *
 * These are the same getters `AttestedWorldID` (finality, quorum) and `CreditLine`
 * (security budget, chain assertion) call on-chain, so the page shows the guard inputs,
 * not an approximation of them.
 */
export function usePrecompiles(options: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ["precompiles"],
    refetchInterval: options.refetchInterval ?? 30_000,
    queryFn: async (): Promise<PrecompileSnapshot> => {
      const client = getPublicClient();

      let supported: readonly {
        chainKey: bigint;
        chainId: bigint;
        chainName: `0x${string}`;
        chainEncoding: number;
      }[];
      try {
        supported = (await client.readContract({
          address: PRECOMPILES.chainInfo,
          abi: chainInfoAbi,
          functionName: "get_supported_chains",
        })) as typeof supported;
      } catch {
        return { chains: [], available: false };
      }

      const wanted = new Set(SOURCE_CHAIN_LIST.map((c) => c.chainKey as number));
      const rows = supported
        .filter((entry) => wanted.has(Number(entry.chainKey)))
        .map((entry) => ({
          chainKey: Number(entry.chainKey),
          chainId: Number(entry.chainId),
          chainName: decodeChainName(entry.chainName),
          chainEncoding: Number(entry.chainEncoding),
        }));

      const chains = await Promise.all(
        rows.map(async (row): Promise<PrecompileChainRow> => {
          const key = BigInt(row.chainKey);
          const soft = <T,>(p: Promise<T>) => p.catch(() => undefined);
          const [attestation, checkpoint, byKey, attestors, minBond] = await Promise.all([
            soft(client.readContract({ address: PRECOMPILES.chainInfo, abi: chainInfoAttestationAbi, functionName: "get_latest_attestation_height_and_hash", args: [key] })),
            soft(client.readContract({ address: PRECOMPILES.chainInfo, abi: chainInfoAttestationAbi, functionName: "get_latest_checkpoint_height_and_hash", args: [key] })),
            soft(client.readContract({ address: PRECOMPILES.chainInfo, abi: chainInfoLookupAbi, functionName: "get_chain_by_key", args: [key] })),
            soft(client.readContract({ address: PRECOMPILES.attestorStash, abi: attestorStashAbi, functionName: "getAttestorsCount", args: [key] })),
            soft(client.readContract({ address: PRECOMPILES.attestorStash, abi: attestorStashAbi, functionName: "getMinBondRequirement", args: [key] })),
          ]);
          const expected = SOURCE_CHAINS[row.chainKey as SourceChainKey]?.chainId;
          const count = attestors === undefined ? undefined : Number(attestors);
          return {
            ...row,
            attestedTip: attestation?.exists ? attestation.height : undefined,
            checkpointTip: checkpoint?.exists ? checkpoint.height : undefined,
            attestors: count,
            minBond,
            bondedCapital: count !== undefined && minBond !== undefined ? BigInt(count) * minBond : undefined,
            chainIdMatches:
              byKey && expected !== undefined ? byKey.exists && Number(byKey.info.chainId) === expected : undefined,
          };
        }),
      );

      return { chains, available: true };
    },
  });
}

/** `chainName` comes back as raw bytes; render it as UTF-8 when it looks like it. */
function decodeChainName(value: `0x${string}`): string {
  try {
    const decoded = hexToString(value).replace(/\0+$/, "");
    return /^[\x20-\x7e]+$/.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}
