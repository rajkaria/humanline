// Source-chain (Ethereum mainnet / Sepolia) log scanning for World ID TreeChanged events.
import { JsonRpcProvider, Network, type Block, type Log } from "ethers";
import {
  LOG_WINDOW,
  TREE_CHANGED_TOPIC,
  type SourceConfig,
  sourceRpcUrl,
  sourceRpcUrls,
} from "./config";

function chainIdOf(source: SourceConfig): number {
  return source.name === "mainnet" ? 1 : 11155111;
}

export function sourceProvider(source: SourceConfig, url = sourceRpcUrl(source)): JsonRpcProvider {
  return new JsonRpcProvider(url, Network.from(chainIdOf(source)), { staticNetwork: true });
}

/**
 * A source-chain reader that fails over between RPC endpoints. Public Ethereum endpoints
 * differ wildly in what they allow (`eth_getLogs` bans, range caps, rate limits), so every
 * call walks the candidate list and sticks with whichever endpoint answered last.
 */
export class LogSource {
  readonly urls: string[];
  private providers: JsonRpcProvider[];
  private active = 0;

  constructor(source: SourceConfig, urls = sourceRpcUrls(source)) {
    this.urls = urls;
    this.providers = urls.map(
      (u) => new JsonRpcProvider(u, Network.from(chainIdOf(source)), { staticNetwork: true }),
    );
  }

  get activeUrl(): string {
    return this.urls[this.active]!;
  }

  /** Runs `fn` against each endpoint in turn; the first success pins the active endpoint. */
  private async withFailover<T>(
    fn: (p: JsonRpcProvider) => Promise<T>,
    onFailover?: (url: string, err: Error) => void,
  ): Promise<T> {
    const order = [
      ...this.providers.slice(this.active),
      ...this.providers.slice(0, this.active),
    ];
    let lastErr: unknown;
    for (const [offset, provider] of order.entries()) {
      const index = (this.active + offset) % this.providers.length;
      try {
        const result = await fn(provider);
        this.active = index;
        return result;
      } catch (e) {
        lastErr = e;
        onFailover?.(this.urls[index]!, e as Error);
      }
    }
    throw lastErr;
  }

  getBlockNumber(onFailover?: (url: string, err: Error) => void): Promise<number> {
    return this.withFailover((p) => p.getBlockNumber(), onFailover);
  }

  getBlock(n: number, onFailover?: (url: string, err: Error) => void): Promise<Block | null> {
    return this.withFailover((p) => p.getBlock(n), onFailover);
  }

  getLogs(
    filter: { address: string; topics: string[]; fromBlock: number; toBlock: number },
    onFailover?: (url: string, err: Error) => void,
  ): Promise<Log[]> {
    return this.withFailover((p) => p.getLogs(filter), onFailover);
  }
}

export interface TreeChangedEvent {
  blockNumber: number;
  logIndex: number;
  txHash: string;
  txIndex: number;
  preRoot: bigint;
  kind: number;
  postRoot: bigint;
}

/** One transaction that changed the tree, with its (single) tree change. */
export interface SourceTx {
  txHash: string;
  blockNumber: number;
  txIndex: number;
  logIndex: number;
  preRoot: bigint;
  kind: number;
  postRoot: bigint;
}

/** Splits [from, to] into inclusive windows of at most `size` blocks. Pure. */
export function planWindows(from: number, to: number, size = LOG_WINDOW): Array<[number, number]> {
  if (size <= 0) throw new Error("window size must be positive");
  if (to < from) return [];
  const out: Array<[number, number]> = [];
  for (let start = from; start <= to; start += size) {
    out.push([start, Math.min(start + size - 1, to)]);
  }
  return out;
}

/**
 * Orders raw TreeChanged logs by (blockNumber, logIndex) and collapses them to one entry per
 * transaction, keeping the first log of each tx. Never reorders, never drops a transaction.
 * Pure — the network stays in `scanTreeChanged`.
 */
export function toOrderedSourceTxs(events: TreeChangedEvent[]): SourceTx[] {
  const sorted = [...events].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );
  const seen = new Set<string>();
  const out: SourceTx[] = [];
  for (const e of sorted) {
    const key = e.txHash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      txHash: e.txHash,
      blockNumber: e.blockNumber,
      txIndex: e.txIndex,
      logIndex: e.logIndex,
      preRoot: e.preRoot,
      kind: e.kind,
      postRoot: e.postRoot,
    });
  }
  return out;
}

export function parseTreeChangedLog(log: {
  blockNumber: number;
  index: number;
  transactionHash: string;
  transactionIndex: number;
  topics: readonly string[];
}): TreeChangedEvent {
  return {
    blockNumber: log.blockNumber,
    logIndex: log.index,
    txHash: log.transactionHash,
    txIndex: log.transactionIndex,
    preRoot: BigInt(log.topics[1]!),
    kind: Number(BigInt(log.topics[2]!)),
    postRoot: BigInt(log.topics[3]!),
  };
}

export interface ScanOptions {
  logs: LogSource;
  manager: string;
  fromBlock: number;
  toBlock: number;
  windowSize?: number;
  onWindow?: (from: number, to: number, found: number) => void;
  onFailover?: (url: string, err: Error) => void;
}

/** eth_getLogs for TreeChanged from the identity manager, in bounded windows. */
export async function scanTreeChanged(opts: ScanOptions): Promise<SourceTx[]> {
  const windows = planWindows(opts.fromBlock, opts.toBlock, opts.windowSize ?? LOG_WINDOW);
  const events: TreeChangedEvent[] = [];
  for (const [from, to] of windows) {
    const logs = await opts.logs.getLogs(
      { address: opts.manager, topics: [TREE_CHANGED_TOPIC], fromBlock: from, toBlock: to },
      opts.onFailover,
    );
    for (const log of logs) events.push(parseTreeChangedLog(log as never));
    opts.onWindow?.(from, to, logs.length);
  }
  return toOrderedSourceTxs(events);
}

/**
 * Walks backwards from the head in `windowSize` steps until at least one TreeChanged is
 * found. Used by `bootstrap` to seed the first root without a hand-picked tx hash.
 */
export async function findLatestTreeChanged(
  logs: LogSource,
  manager: string,
  opts: { maxLookback?: number; windowSize?: number } = {},
): Promise<SourceTx | undefined> {
  const head = await logs.getBlockNumber();
  const windowSize = opts.windowSize ?? LOG_WINDOW;
  const maxLookback = opts.maxLookback ?? windowSize * 10;
  for (let end = head; end > head - maxLookback && end > 0; end -= windowSize) {
    const start = Math.max(0, end - windowSize + 1);
    const found = await scanTreeChanged({
      logs,
      manager,
      fromBlock: start,
      toBlock: end,
      windowSize,
    });
    if (found.length > 0) return found[found.length - 1];
  }
  return undefined;
}
