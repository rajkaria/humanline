/**
 * Paginated `eth_getLogs` for public RPC endpoints.
 *
 * Public nodes cap the block range of a single `getLogs` call, so every historic
 * scan on this site walks forward in windows. 50k blocks is the window the CC3
 * testnet RPC accepts comfortably; the helper halves it and retries when a node
 * complains, so a stricter endpoint degrades to more requests rather than an
 * empty table.
 */

import type { AbiEvent, Address, Log, PublicClient } from "viem";

export const DEFAULT_WINDOW = 50_000n;

export type ScanOptions = {
  client: PublicClient;
  address: Address | Address[];
  event: AbiEvent;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  window?: bigint;
  /** Stop early once this many logs have been collected (newest scan first). */
  limit?: number;
  /** Scan newest-first, which is what every table on this site wants. */
  descending?: boolean;
  signal?: AbortSignal;
};

/** Logs are returned in ascending block order unless `descending` is set. */
export async function scanLogs<TLog = Log>(options: ScanOptions): Promise<TLog[]> {
  const {
    client,
    address,
    event,
    args,
    fromBlock,
    toBlock,
    window = DEFAULT_WINDOW,
    limit,
    descending = true,
    signal,
  } = options;

  if (toBlock < fromBlock) return [];

  const collected: TLog[] = [];
  const ranges = buildRanges(fromBlock, toBlock, window, descending);

  for (const range of ranges) {
    if (signal?.aborted) break;
    const logs = await getLogsWithBackoff({
      client,
      address,
      event,
      args,
      from: range.from,
      to: range.to,
      window,
    });
    collected.push(...(logs as TLog[]));
    if (limit !== undefined && collected.length >= limit) break;
  }

  // Within a window viem returns ascending order; flip each window's contents
  // when scanning newest-first so the overall sequence is monotonic.
  if (descending) {
    collected.reverse();
    // `collected` is now [oldest…newest] reversed per-window; sort to be exact.
    collected.sort((a, b) => compareLogs(b, a));
  } else {
    collected.sort((a, b) => compareLogs(a, b));
  }

  return limit === undefined ? collected : collected.slice(0, limit);
}

function compareLogs(a: unknown, b: unknown): number {
  const la = a as { blockNumber?: bigint | null; logIndex?: number | null };
  const lb = b as { blockNumber?: bigint | null; logIndex?: number | null };
  const ba = la.blockNumber ?? 0n;
  const bb = lb.blockNumber ?? 0n;
  if (ba !== bb) return ba < bb ? -1 : 1;
  return (la.logIndex ?? 0) - (lb.logIndex ?? 0);
}

function buildRanges(
  fromBlock: bigint,
  toBlock: bigint,
  window: bigint,
  descending: boolean,
): Array<{ from: bigint; to: bigint }> {
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  if (descending) {
    let end = toBlock;
    while (end >= fromBlock) {
      const start = end - window + 1n > fromBlock ? end - window + 1n : fromBlock;
      ranges.push({ from: start, to: end });
      if (start === fromBlock) break;
      end = start - 1n;
    }
  } else {
    let start = fromBlock;
    while (start <= toBlock) {
      const end = start + window - 1n < toBlock ? start + window - 1n : toBlock;
      ranges.push({ from: start, to: end });
      if (end === toBlock) break;
      start = end + 1n;
    }
  }
  return ranges;
}

async function getLogsWithBackoff(params: {
  client: PublicClient;
  address: Address | Address[];
  event: AbiEvent;
  args?: Record<string, unknown>;
  from: bigint;
  to: bigint;
  window: bigint;
}): Promise<Log[]> {
  const { client, address, event, args, from, to } = params;
  try {
    return (await client.getLogs({
      address,
      event,
      // viem types `args` per-event; the caller supplies matching keys.
      args: args as never,
      fromBlock: from,
      toBlock: to,
    })) as Log[];
  } catch (error) {
    // A node that refuses the range: split once and retry each half. One level
    // of recursion per failure keeps the worst case bounded.
    const span = to - from;
    if (span <= 1_000n) throw error;
    const mid = from + span / 2n;
    const left = await getLogsWithBackoff({ ...params, from, to: mid });
    const right = await getLogsWithBackoff({ ...params, from: mid + 1n, to });
    return [...left, ...right];
  }
}
