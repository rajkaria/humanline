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

/**
 * Hard ceiling on how many windows one scan may walk.
 *
 * `limit` alone is not a bound: a feed with five events never reaches it, so a
 * scan whose floor fell back to block 0 would walk the whole chain — on a 15s
 * refresh timer, across two contracts, and again across five event types for the
 * loan history. 40 x 50k covers the most recent 2,000,000 blocks, which is far
 * more history than any of these views needs, and {@link ScanResult.truncated}
 * tells the caller when the cap cut the range short so the UI can say "the last
 * N blocks" rather than implying it saw everything.
 */
export const DEFAULT_MAX_WINDOWS = 40;

export type ScanResult<TLog> = {
  logs: TLog[];
  /** The oldest block actually scanned. */
  scannedFrom: bigint;
  /** `true` when the window cap stopped the scan before `fromBlock`. */
  truncated: boolean;
};

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
  /** Ceiling on windows walked. Defaults to {@link DEFAULT_MAX_WINDOWS}. */
  maxWindows?: number;
  /** Scan newest-first, which is what every table on this site wants. */
  descending?: boolean;
  signal?: AbortSignal;
};

/**
 * Scan a block range for one event.
 *
 * Logs come back in ascending block order unless `descending` is set, and the
 * result says how far back the scan actually reached.
 */
export async function scanLogs<TLog = Log>(
  options: ScanOptions,
): Promise<ScanResult<TLog>> {
  const {
    client,
    address,
    event,
    args,
    fromBlock,
    toBlock,
    window = DEFAULT_WINDOW,
    limit,
    maxWindows = DEFAULT_MAX_WINDOWS,
    descending = true,
    signal,
  } = options;

  if (toBlock < fromBlock) {
    return { logs: [], scannedFrom: toBlock, truncated: false };
  }

  const allRanges = buildRanges(fromBlock, toBlock, window, descending);
  const ranges = allRanges.slice(0, Math.max(1, maxWindows));
  const truncated = ranges.length < allRanges.length;

  const collected: TLog[] = [];
  let scannedFrom = descending ? toBlock : fromBlock;

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
    if (range.from < scannedFrom) scannedFrom = range.from;
    if (limit !== undefined && collected.length >= limit) break;
  }

  // Sort into a single monotonic sequence; each window arrives ascending, and
  // when scanning newest-first the windows themselves arrive in reverse.
  collected.sort((a, b) => (descending ? compareLogs(b, a) : compareLogs(a, b)));

  return {
    logs: limit === undefined ? collected : collected.slice(0, limit),
    scannedFrom,
    truncated,
  };
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
