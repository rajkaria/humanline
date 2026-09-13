/**
 * Shareable per-human pages, `/h/{short}`: the first 12 hex digits of a World ID nullifier. Short
 * enough to paste, long enough (48 bits) that two humans colliding is not a practical concern at this
 * scale; if it ever happens the page lists every match rather than picking one.
 */

import type { PublicClient } from "viem";

import { humanRegistryAbi } from "@/lib/abi";
import { PROFILES, type ProfileId } from "@/lib/profiles";

export const SHORT_LENGTH = 12;

export function shortOf(human: bigint): string {
  return human.toString(16).padStart(64, "0").slice(0, SHORT_LENGTH);
}

export function isShort(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${SHORT_LENGTH}}$`).test(value);
}

export type ShareMatch = { profile: ProfileId; human: bigint; wallet: `0x${string}`; block: bigint };

const WINDOW = 5_000n;

/** Find every registered human whose nullifier starts with `short`, across both deployments. */
export async function findHumans(
  client: Pick<PublicClient, "getBlockNumber" | "getContractEvents" | "getTransactionReceipt" | "readContract">,
  short: string,
): Promise<ShareMatch[]> {
  if (!isShort(short)) return [];
  const head = await client.getBlockNumber();
  const matches: ShareMatch[] = [];
  for (const profile of Object.keys(PROFILES) as ProfileId[]) {
    const { deployment } = PROFILES[profile];
    const registry = deployment.contracts.humanRegistry.address;
    if (!registry) continue;
    let from = deployment.deploymentBlockOf("humanRegistry");
    const hash = deployment.deploymentTxHashOf("humanRegistry");
    if (from === 0n && hash) from = (await client.getTransactionReceipt({ hash }).catch(() => null))?.blockNumber ?? 0n;
    if (from === 0n) from = head > 200_000n ? head - 200_000n : 0n;

    const seen = new Set<bigint>();
    for (let start = from; start <= head; start += WINDOW) {
      const end = start + WINDOW - 1n < head ? start + WINDOW - 1n : head;
      const events = await client.getContractEvents({
        address: registry,
        abi: humanRegistryAbi,
        eventName: "HumanRegistered",
        fromBlock: start,
        toBlock: end,
      });
      for (const e of events) {
        const human = (e.args as { nullifierHash: bigint }).nullifierHash;
        if (seen.has(human) || shortOf(human) !== short) continue;
        seen.add(human);
        const wallet = (await client.readContract({ address: registry, abi: humanRegistryAbi, functionName: "walletOf", args: [human] })) as `0x${string}`;
        matches.push({ profile, human, wallet, block: e.blockNumber ?? 0n });
      }
    }
  }
  return matches;
}
