/**
 * A wall clock for the relay report. Server-only.
 *
 * A healthy cold report scans both chains in about ten seconds. When an RPC starts
 * refusing `eth_getLogs`, the scan instead retries window after window until the
 * function's own limit kills it, and every five-minute cron run then holds a whole
 * instance for 300 seconds. The deadline answers on time and stops the scan.
 */

export class RelayReportTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`relay report timed out after ${Math.round(ms / 1000)}s`);
    this.name = "RelayReportTimeoutError";
  }
}

/**
 * Run `work` with a signal that aborts after `ms`, and reject at that moment even if
 * one RPC call inside `work` is still in flight. The scans check the signal between
 * windows, so nothing keeps walking the chain after the caller has its answer.
 */
export async function runWithDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new RelayReportTimeoutError(ms);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  const running = work(controller.signal);
  // Once the deadline has answered, a late failure inside `work` is expected noise.
  running.catch(() => undefined);
  try {
    return await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
