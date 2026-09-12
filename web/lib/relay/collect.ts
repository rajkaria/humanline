/**
 * Read the relay's track record from chain and turn it into `lib/relay/stats`
 * samples. Server-only.
 *
 * Sources, all public:
 *  - `RootRelayed` on both AttestedWorldID instances (CC3), from their deploy blocks;
 *  - the CC3 block timestamp of each relay transaction;
 *  - the source-chain block timestamp of each relayed update (Ethereum / Sepolia);
 *  - `TreeChanged` updates the finality guard already accepts but Creditcoin does not
 *    have yet, which are the "pending" roots the watchdog cares about.
 */

import { getAbiItem, type AbiEvent, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { attestedWorldIdAbi } from "@/lib/abi";
import type { SourceChainKey } from "@/lib/chains";
import { CONTRACTS, WORLD_ID_INSTANCES } from "@/lib/contracts";
import rawDeployments from "@/lib/generated/deployments.json";
import { scanLogs } from "@/lib/logs";
import { readRootState, scanChanges, sourceClient } from "@/lib/relay/source";
import type { PendingRoot, RelaySample } from "@/lib/relay/stats";

const ROOT_RELAYED = getAbiItem({ abi: attestedWorldIdAbi, name: "RootRelayed" }) as AbiEvent;

export type ChainTrack = {
  chainKey: SourceChainKey;
  contract: Hex;
  samples: RelaySample[];
  pending: PendingRoot[];
  finalityDepth: number;
  attestedTip: number;
};

const sourceTimestamps = new Map<string, number>();

async function sourceTimestamp(chainKey: SourceChainKey, block: number): Promise<number | undefined> {
  const key = `${chainKey}:${block}`;
  const hit = sourceTimestamps.get(key);
  if (hit !== undefined) return hit;
  try {
    const b = await sourceClient(chainKey).getBlock({ blockNumber: BigInt(block) });
    const ts = Number(b.timestamp);
    sourceTimestamps.set(key, ts);
    return ts;
  } catch {
    return undefined;
  }
}

/**
 * Addresses that belong to the Humanline operator: `RELAY_OPERATOR_ADDRESSES`,
 * `RELAYER_ADDRESS`, the address behind `RELAYER_PRIVATE_KEY`, and the recorded
 * deployer. Everyone else who relayed is, by definition, not us.
 */
export function operatorAddresses(): string[] {
  const listed = [process.env.RELAY_OPERATOR_ADDRESSES ?? "", process.env.RELAYER_ADDRESS ?? ""]
    .join(",")
    .split(",")
    .map((a) => a.trim());
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) listed.push(privateKeyToAccount(key as Hex).address);
  const deployer = (rawDeployments as { deployer?: string }).deployer;
  if (deployer) listed.push(deployer);
  return [...new Set(listed.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)).map((a) => a.toLowerCase()))];
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function collectTrack(client: PublicClient, chainKey: SourceChainKey): Promise<ChainTrack> {
  const key = WORLD_ID_INSTANCES.find((i) => i.chainKey === chainKey)!.key;
  const resolved = CONTRACTS[key];
  const contract = resolved.address;
  if (!contract) throw new Error(`no AttestedWorldID for chainKey ${chainKey}`);

  const tip = await client.getBlockNumber();
  let fromBlock = resolved.deploymentBlock ?? 0n;
  if (fromBlock === 0n && resolved.deploymentTxHash) {
    const receipt = await client.getTransactionReceipt({ hash: resolved.deploymentTxHash });
    fromBlock = receipt.blockNumber;
  }

  const [scan, state] = await Promise.all([
    scanLogs({ client, address: contract, event: ROOT_RELAYED, fromBlock, toBlock: tip, maxWindows: 80 }),
    readRootState(client, contract, chainKey, 1n),
  ]);

  type Log = { blockNumber: bigint; transactionHash: Hex; args: { sourceBlock: bigint; postRoot: bigint; relayer: Hex } };
  const logs = scan.logs as unknown as Log[];

  const ccBlocks = [...new Set(logs.map((l) => l.blockNumber))];
  const ccTimes = new Map<bigint, number>();
  await mapLimit(ccBlocks, 8, async (blockNumber) => {
    try {
      ccTimes.set(blockNumber, Number((await client.getBlock({ blockNumber })).timestamp));
    } catch {
      // a block we cannot read drops that sample rather than inventing a time
    }
  });

  const sourceBlocks = [...new Set(logs.map((l) => Number(l.args.sourceBlock)))];
  await mapLimit(sourceBlocks, 6, (b) => sourceTimestamp(chainKey, b));

  const samples: RelaySample[] = [];
  for (const l of logs) {
    const relayedAt = ccTimes.get(l.blockNumber);
    const srcTs = sourceTimestamps.get(`${chainKey}:${Number(l.args.sourceBlock)}`);
    if (relayedAt === undefined || srcTs === undefined) continue;
    samples.push({
      chainKey,
      sourceBlock: Number(l.args.sourceBlock),
      sourceTimestamp: srcTs,
      relayedAt,
      relayer: l.args.relayer,
      creditcoinTxHash: l.transactionHash,
    });
  }

  // Pending: updates at or after the newest relayed source block that the finality guard
  // already accepts, whose root Creditcoin does not have.
  const relayedRoots = new Set(logs.map((l) => l.args.postRoot));
  const maxRelayed = logs.reduce((m, l) => Math.max(m, Number(l.args.sourceBlock)), 0);
  const ceiling = state.attestedTip - state.finalityDepth;
  const pending: PendingRoot[] = [];
  if (maxRelayed > 0 && ceiling >= maxRelayed) {
    const changes = await scanChanges(chainKey, maxRelayed, ceiling);
    for (const c of changes) {
      if (relayedRoots.has(c.postRoot)) continue;
      const ts = await sourceTimestamp(chainKey, c.blockNumber);
      if (ts !== undefined) pending.push({ chainKey, sourceBlock: c.blockNumber, sourceTimestamp: ts });
    }
  }

  return { chainKey, contract, samples, pending, finalityDepth: state.finalityDepth, attestedTip: state.attestedTip };
}
