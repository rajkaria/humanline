"use client";

import { useQuery } from "@tanstack/react-query";
import { hexToString } from "viem";

import { attestorStashAbi, chainInfoAbi, chainInfoHeightAbi } from "@/lib/abi";
import { PRECOMPILES, SOURCE_CHAIN_LIST } from "@/lib/chains";
import { getPublicClient } from "@/lib/public-client";

export type PrecompileChainRow = {
  chainKey: number;
  chainId: number;
  chainName: string;
  chainEncoding: number;
  /** Latest height attested for that chain. */
  attestedTip?: bigint;
  /** Whether the tip came from the 0x0FD3 precompile or the proof builder. */
  attestedTipSource?: "precompile" | "proof-builder";
  /** How many attestors currently back the chain. */
  attestors?: number;
};

export type PrecompileSnapshot = {
  chains: PrecompileChainRow[];
  /** `false` when `get_supported_chains` itself failed — not a CC3 node, say. */
  available: boolean;
  /** Set when the attested-height getter could not be resolved. */
  heightGetterUnavailable: boolean;
};

/**
 * Read the Attestcoin precompiles directly, with no wallet.
 *
 * `0x0FD3` lists the chains this node attests; `0x0FD4` reports how many
 * attestors back each one. The "latest attested height" getter's exact name is
 * still being confirmed against `chain_info.sol` upstream, so it is probed and
 * quietly dropped when the call reverts rather than failing the whole header.
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
        return { chains: [], available: false, heightGetterUnavailable: true };
      }

      // Only the source chains Humanline actually relays from are interesting.
      const wanted = new Set(SOURCE_CHAIN_LIST.map((c) => c.chainKey as number));
      const rows = supported
        .filter((entry) => wanted.has(Number(entry.chainKey)))
        .map((entry) => ({
          chainKey: Number(entry.chainKey),
          chainId: Number(entry.chainId),
          chainName: decodeChainName(entry.chainName),
          chainEncoding: Number(entry.chainEncoding),
        }));

      let heightGetterUnavailable = false;

      const enriched = await Promise.all(
        rows.map(async (row): Promise<PrecompileChainRow> => {
          const [tip, attestors] = await Promise.all([
            client
              .readContract({
                address: PRECOMPILES.chainInfo,
                abi: chainInfoHeightAbi,
                functionName: "get_latest_attested_height",
                args: [BigInt(row.chainKey)],
              })
              .then((result) => {
                const value = result as { height: bigint; exists: boolean };
                return value.exists ? value.height : undefined;
              })
              .catch(() => {
                heightGetterUnavailable = true;
                return undefined;
              }),
            client
              .readContract({
                address: PRECOMPILES.attestorStash,
                abi: attestorStashAbi,
                functionName: "getAttestorsCount",
                args: [BigInt(row.chainKey)],
              })
              .then((count) => Number(count))
              .catch(() => undefined),
          ]);

          if (tip !== undefined) {
            return { ...row, attestedTip: tip, attestedTipSource: "precompile", attestors };
          }

          // Second opinion: the CC3 proof builder exposes the same number over
          // HTTP. It is not a substitute for the on-chain guard — the contract
          // still reads 0x0FD3 — but it lets this page show the value while the
          // precompile getter's exact name is being confirmed upstream.
          const fallback = await fetchAttestedHeight(row.chainKey);
          return {
            ...row,
            attestedTip: fallback,
            attestedTipSource: fallback === undefined ? undefined : "proof-builder",
            attestors,
          };
        }),
      );

      return { chains: enriched, available: true, heightGetterUnavailable };
    },
  });
}

/** Ask our own proxy for the proof builder's attested height. */
async function fetchAttestedHeight(chainKey: number): Promise<bigint | undefined> {
  try {
    const response = await fetch(`/api/attestcoin/attested-height?chainKey=${chainKey}`, {
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { attestedHeight?: number | string | null };
    if (data.attestedHeight === null || data.attestedHeight === undefined) return undefined;
    return BigInt(data.attestedHeight);
  } catch {
    return undefined;
  }
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
