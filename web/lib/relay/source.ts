/**
 * Server-side reads for self-relay: World ID `TreeChanged` logs on the source
 * chain, and the Creditcoin state the relay plan depends on.
 *
 * Kept out of the browser on purpose. Public Ethereum endpoints differ in what
 * they allow (mainnet's default refuses `eth_getLogs` outright), so the route
 * walks a fallback list server-side and the browser only ever sees a plan.
 */

import {
  createPublicClient,
  fallback,
  http,
  parseAbiItem,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import { attestedWorldIdAbi, chainInfoAttestationAbi, chainInfoLookupAbi } from "@/lib/abi";
import { PRECOMPILES, SOURCE_CHAINS, type SourceChainKey } from "@/lib/chains";
import type { TreeChange } from "@/lib/relay/plan";

export const TREE_CHANGED_EVENT = parseAbiItem(
  "event TreeChanged(uint256 indexed preRoot, uint8 indexed kind, uint256 indexed postRoot)",
);

type SourceRpc = { env: string | undefined; defaults: string[] };

/** Env first (comma-separated allowed), then endpoints known to serve `eth_getLogs`. */
const RPCS: Record<SourceChainKey, SourceRpc> = {
  1: {
    env: process.env.ETH_SEPOLIA_RPC,
    defaults: ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co"],
  },
  3: {
    env: process.env.ETH_MAINNET_RPC,
    defaults: [
      "https://mainnet.gateway.tenderly.co",
      "https://gateway.tenderly.co/public/mainnet",
      "https://ethereum-rpc.publicnode.com",
    ],
  },
};

export function sourceRpcUrls(chainKey: SourceChainKey): string[] {
  const rpc = RPCS[chainKey];
  const fromEnv = (rpc.env ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...rpc.defaults])];
}

const clients = new Map<SourceChainKey, PublicClient>();

export function sourceClient(chainKey: SourceChainKey): PublicClient {
  let client = clients.get(chainKey);
  if (!client) {
    client = createPublicClient({
      chain: chainKey === 3 ? mainnet : sepolia,
      transport: fallback(
        sourceRpcUrls(chainKey).map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
      ),
    }) as PublicClient;
    clients.set(chainKey, client);
  }
  return client;
}

/** 50k blocks is what publicnode accepts for a topic-filtered scan; halved on refusal. */
export const SOURCE_LOG_WINDOW = 50_000;
const MIN_WINDOW = 2_000;

type RawTreeLog = {
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  transactionIndex: number | null;
  logIndex: number | null;
  args: { preRoot?: bigint; kind?: number; postRoot?: bigint };
};

export function toTreeChange(log: RawTreeLog): TreeChange {
  return {
    txHash: (log.transactionHash ?? "0x").toLowerCase() as Hex,
    blockNumber: Number(log.blockNumber ?? 0n),
    txIndex: log.transactionIndex ?? 0,
    logIndex: log.logIndex ?? 0,
    preRoot: log.args.preRoot ?? 0n,
    postRoot: log.args.postRoot ?? 0n,
    kind: Number(log.args.kind ?? 0),
  };
}

function isRangeRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /range|limit|too many|timeout|exceed|size/i.test(message);
}

async function getTreeLogs(
  client: PublicClient,
  manager: Hex,
  fromBlock: number,
  toBlock: number,
  postRoot?: bigint,
): Promise<TreeChange[]> {
  const out: TreeChange[] = [];
  let window = SOURCE_LOG_WINDOW;
  let from = fromBlock;
  while (from <= toBlock) {
    const to = Math.min(toBlock, from + window - 1);
    try {
      const logs = await client.getLogs({
        address: manager,
        event: TREE_CHANGED_EVENT,
        args: postRoot === undefined ? undefined : { postRoot },
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
        strict: true,
      });
      out.push(...logs.map((l) => toTreeChange(l as unknown as RawTreeLog)));
      from = to + 1;
    } catch (error) {
      if (!isRangeRefusal(error) || window <= MIN_WINDOW) throw error;
      window = Math.max(MIN_WINDOW, Math.floor(window / 2));
    }
  }
  return out;
}

/**
 * The update whose `postRoot` is `root`, searching backwards from `toBlock`.
 * `postRoot` is an indexed topic, so each window is one cheap filtered query.
 */
export async function findChangeByPostRoot(
  chainKey: SourceChainKey,
  root: bigint,
  { toBlock, maxLookback = 400_000 }: { toBlock: number; maxLookback?: number },
): Promise<TreeChange | null> {
  const client = sourceClient(chainKey);
  const manager = SOURCE_CHAINS[chainKey].identityManager;
  const floor = Math.max(0, toBlock - maxLookback);
  for (let end = toBlock; end >= floor; end -= SOURCE_LOG_WINDOW) {
    const start = Math.max(floor, end - SOURCE_LOG_WINDOW + 1);
    const found = await getTreeLogs(client, manager, start, end, root);
    if (found.length > 0) return found[found.length - 1]!;
    if (start === floor) break;
  }
  return null;
}

/** Every update in `[fromBlock, toBlock]`, in source order. */
export async function scanChanges(
  chainKey: SourceChainKey,
  fromBlock: number,
  toBlock: number,
): Promise<TreeChange[]> {
  if (toBlock < fromBlock) return [];
  const logs = await getTreeLogs(sourceClient(chainKey), SOURCE_CHAINS[chainKey].identityManager, fromBlock, toBlock);
  return logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export async function sourceHead(chainKey: SourceChainKey): Promise<number> {
  return Number(await sourceClient(chainKey).getBlockNumber());
}

// ---------------------------------------------------------------------------
// Creditcoin side
// ---------------------------------------------------------------------------

export type CreditcoinRootState = {
  targetKnown: boolean;
  latestRoot: bigint | null;
  finalityDepth: number;
  sourceBlockTime: number;
  attestedTip: number;
};

/**
 * `AttestedWorldID._attestedTip()` reproduced: the higher of ChainInfo's latest
 * attestation and latest checkpoint for the source chain.
 */
export async function attestedTip(client: PublicClient, chainKey: SourceChainKey): Promise<number> {
  const read = (functionName: "get_latest_attestation_height_and_hash" | "get_latest_checkpoint_height_and_hash") =>
    client
      .readContract({
        address: PRECOMPILES.chainInfo,
        abi: chainInfoAttestationAbi,
        functionName,
        args: [BigInt(chainKey)],
      })
      .then((r) => (r.exists ? Number(r.height) : 0))
      .catch(() => 0);
  const [attestation, checkpoint] = await Promise.all([
    read("get_latest_attestation_height_and_hash"),
    read("get_latest_checkpoint_height_and_hash"),
  ]);
  return Math.max(attestation, checkpoint);
}

/**
 * ChainInfo `is_height_attested`: whether a continuity proof can already reach this source
 * height. `undefined` when the precompile could not be read — never guessed.
 */
export async function isHeightAttested(
  client: PublicClient,
  chainKey: SourceChainKey,
  height: number,
): Promise<boolean | undefined> {
  return client
    .readContract({
      address: PRECOMPILES.chainInfo,
      abi: chainInfoLookupAbi,
      functionName: "is_height_attested",
      args: [BigInt(chainKey), BigInt(height)],
    })
    .catch(() => undefined);
}

export async function readRootState(
  client: PublicClient,
  contract: Hex,
  chainKey: SourceChainKey,
  target: bigint,
): Promise<CreditcoinRootState> {
  const read = <T>(functionName: string, args?: readonly unknown[]) =>
    client.readContract({
      address: contract,
      abi: attestedWorldIdAbi,
      functionName: functionName as "latestRoot",
      args: args as never,
    }) as Promise<T>;

  const [targetKnown, latestRoot, finalityDepth, sourceBlockTime, tip] = await Promise.all([
    read<boolean>("isValidRoot", [target]),
    // `latestRoot()` reverts NoRootsSeen before the first relay: that is "no tip yet".
    read<bigint>("latestRoot").catch((error: unknown) => {
      if (/NoRootsSeen/.test(String((error as Error)?.message ?? error))) return null;
      throw error;
    }),
    read<bigint>("FINALITY_DEPTH"),
    read<bigint>("SOURCE_BLOCK_TIME"),
    attestedTip(client, chainKey),
  ]);

  return {
    targetKnown,
    latestRoot,
    finalityDepth: Number(finalityDepth),
    sourceBlockTime: Number(sourceBlockTime),
    attestedTip: tip,
  };
}
