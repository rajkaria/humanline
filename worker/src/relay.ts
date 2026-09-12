// The relay engine: cursor derivation, batch grouping, retry classification (all pure and
// unit-tested), plus the network pipeline that turns source-chain TreeChanged transactions
// into `execute` / `executeBatch` calls on AttestedWorldID.
import type { Contract, JsonRpcProvider, Wallet } from "ethers";
import {
  BATCH_MAX_SIZE,
  BATCH_MAX_SPAN,
  DEFAULT_LOOKBACK_BLOCKS,
  LOG_WINDOW,
  type SourceConfig,
} from "./config";
import {
  attestedWorldId,
  blockProverClient,
  chainInfoProvider,
  computeQueryId,
  isNoRootsSeen,
  proofBuilder,
  revertReason,
} from "./cc3";
import { inspectLocally, type LocalInspection } from "./evmv1";
import {
  fetchBatchProof,
  fetchProof,
  normalizeBatchProof,
  singleToBatch,
  toExecuteArgs,
  toExecuteBatchArgs,
  type NormalizedBatchProof,
  type SingleProof,
} from "./proofs";
import { LogSource, scanTreeChanged, type SourceTx } from "./sources";
import { appendEvidence } from "./evidence";
import { RelayStore, type TxStatus } from "./store";
import { loadAttestedWorldIdAbi } from "./abi";

// ---------------------------------------------------------------------------
// Pure: cursor derivation
// ---------------------------------------------------------------------------

export interface CursorInputs {
  /** Last processed block persisted in sqlite (exclusive lower bound already advanced past). */
  storeCursor?: number;
  /** Highest `sourceBlock` seen in a RootRelayed event on CC3. */
  lastRelayedBlock?: number;
  /** `--from` flag. */
  fromFlag?: number;
  /** Used only when nothing else is known (head - DEFAULT_LOOKBACK_BLOCKS). */
  fallback?: number;
}

/**
 * cursor = max(sqlite cursor, last on-chain RootRelayed sourceBlock + 1, --from).
 * Chain state wins over local state, so a fresh worker or the Actions cron resumes
 * correctly; the cursor only ever moves forward.
 */
export function deriveCursor(inputs: CursorInputs): number {
  const candidates: number[] = [];
  if (inputs.storeCursor !== undefined) candidates.push(inputs.storeCursor);
  if (inputs.lastRelayedBlock !== undefined) candidates.push(inputs.lastRelayedBlock + 1);
  if (inputs.fromFlag !== undefined) candidates.push(inputs.fromFlag);
  if (candidates.length === 0) candidates.push(Math.max(0, inputs.fallback ?? 0));
  return Math.max(...candidates);
}

// ---------------------------------------------------------------------------
// Pure: batch grouping
// ---------------------------------------------------------------------------

export interface BatchGroupOptions {
  maxSpan?: number;
  maxSize?: number;
}

/**
 * Groups *consecutive* transactions (already in source order) into batches where
 * maxBlock - minBlock <= maxSpan and size <= maxSize. Never reorders and never merges
 * across a gap that would break the shared continuity proof.
 */
export function groupIntoBatches<T extends { blockNumber: number }>(
  items: T[],
  opts: BatchGroupOptions = {},
): T[][] {
  const maxSpan = opts.maxSpan ?? BATCH_MAX_SPAN;
  const maxSize = opts.maxSize ?? BATCH_MAX_SIZE;
  if (maxSize <= 0) throw new Error("maxSize must be positive");

  const batches: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    if (current.length === 0) {
      current.push(item);
      continue;
    }
    const min = current[0]!.blockNumber;
    const span = item.blockNumber - min;
    if (current.length >= maxSize || span > maxSpan) {
      batches.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ---------------------------------------------------------------------------
// Pure: revert classification / retry policy
// ---------------------------------------------------------------------------

export type RevertClass =
  /** Someone already relayed this query: success, mark done. */
  | "already-processed"
  /** Chain state will change on its own (attestation lag, thin quorum): retry later. */
  | "transient"
  /** Proof went stale or was rejected by the verifier: refetch the proof and retry once. */
  | "stale-proof"
  /** The transaction can never be relayed (wrong chain, decoy log, reverted source tx). */
  | "permanent"
  /** Unknown: refetch once, then record as failed. */
  | "unknown";

const PERMANENT_ERRORS = [
  "WrongSourceChain",
  "SourceTxReverted",
  "NotIdentityManager",
  "NoTreeChange",
  "AmbiguousTreeChange",
  "CalldataLogMismatch",
  "CannotOverwriteRoot",
];

export function classifyRevert(reason: string): RevertClass {
  const r = reason ?? "";
  // Two spellings reach us: `ASCBase.execute`'s require string ("Query already processed")
  // and AttestedWorldID's own custom error on the batch path, which ethers renders as
  // "QueryAlreadyProcessed(0x…)". Both mean the query is already recorded, i.e. success.
  if (/Query ?[Aa]lready ?[Pp]rocessed/.test(r)) return "already-processed";
  if (r.includes("NotFinal") || r.includes("ThinQuorum")) return "transient";
  if (r.includes("UnknownPreRoot")) return "transient"; // an earlier root must land first
  if (r.includes("Proof of inclusion verification failed")) return "stale-proof";
  if (/continuity|merkle|lower endpoint|attest/i.test(r)) return "stale-proof";
  if (PERMANENT_ERRORS.some((e) => r.includes(e))) return "permanent";
  return "unknown";
}

/** Whether the engine should refetch the proof and try the call one more time. */
export function shouldRetryWithFreshProof(cls: RevertClass): boolean {
  return cls === "stale-proof" || cls === "unknown";
}

export type RetryAction = "mark-already" | "mark-pending" | "refetch-retry" | "mark-failed";

/**
 * The retry decision table. `attempt` counts refetches already performed.
 * - already processed              → done, nothing to do
 * - transient (finality / quorum / ordering) → stay pending, the next pass retries
 * - stale proof or unknown revert  → refetch the proof once, then give up
 * - permanent                      → never retried; recorded as failed, never dropped
 */
export function nextRetryAction(cls: RevertClass, attempt: number, maxRefetches = 1): RetryAction {
  if (cls === "already-processed") return "mark-already";
  if (cls === "transient") return "mark-pending";
  if (attempt < maxRefetches && shouldRetryWithFreshProof(cls)) return "refetch-retry";
  return "mark-failed";
}

export type RetryOutcome<R> =
  | { kind: "success"; result: R; attempts: number }
  | { kind: "already"; reason: string; attempts: number }
  | { kind: "pending"; reason: string; attempts: number }
  | { kind: "failed"; reason: string; attempts: number };

export interface RetryHooks<B, R> {
  send: (batch: B) => Promise<R>;
  /** Fetches a fresh proof for the same transactions. */
  refetch: () => Promise<B>;
  reasonOf?: (err: unknown) => string;
  classify?: (reason: string) => RevertClass;
  maxRefetches?: number;
  onRevert?: (reason: string, cls: RevertClass, action: RetryAction) => void;
}

/**
 * Drives one submission through the retry policy. Pure with respect to the network: every
 * effect is a hook, so the policy is unit-testable with mocks.
 */
export async function executeWithRetry<B, R>(
  batch: B,
  hooks: RetryHooks<B, R>,
): Promise<RetryOutcome<R>> {
  const reasonOf = hooks.reasonOf ?? ((e: unknown) => (e as Error)?.message ?? String(e));
  const classify = hooks.classify ?? classifyRevert;
  let current = batch;
  let attempt = 0;
  for (;;) {
    try {
      const result = await hooks.send(current);
      return { kind: "success", result, attempts: attempt + 1 };
    } catch (e) {
      const reason = reasonOf(e);
      const cls = classify(reason);
      const action = nextRetryAction(cls, attempt, hooks.maxRefetches);
      hooks.onRevert?.(reason, cls, action);
      if (action === "mark-already") return { kind: "already", reason, attempts: attempt + 1 };
      if (action === "mark-pending") return { kind: "pending", reason, attempts: attempt + 1 };
      if (action === "mark-failed") return { kind: "failed", reason, attempts: attempt + 1 };
      attempt += 1;
      current = await hooks.refetch();
    }
  }
}

function isSettledOutcome(status: BatchOutcome["status"]): boolean {
  return status === "relayed" || status === "already";
}

/**
 * Highest block the cursor may move past, or undefined when it may not move at all.
 *
 * Two rules, both needed for "never skip":
 *  1. Only the *leading run* of settled batches counts — a failure stops the advance, so
 *     later blocks stay in scope even if a subsequent batch succeeded.
 *  2. The result is clamped below the first block any unsettled batch touches. Batches can
 *     share a block, because `groupIntoBatches` splits on member count rather than on block
 *     boundaries: a block holding two TreeChanged txs can straddle the 10-member limit.
 *     Without this clamp a settled batch ending at block B would push the cursor to B+1
 *     while B still held an unsettled tx — that root would never be rescanned, and every
 *     later root would then revert UnknownPreRoot forever.
 */
export function settledThrough(
  outcomes: ReadonlyArray<{ status: BatchOutcome["status"]; blockRange: [number, number] }>,
): number | undefined {
  let settledMax: number | undefined;
  let leading = true;
  let firstUnsettledBlock: number | undefined;
  for (const o of outcomes) {
    if (isSettledOutcome(o.status)) {
      if (leading) settledMax = o.blockRange[1];
      continue;
    }
    leading = false;
    const start = o.blockRange[0];
    if (firstUnsettledBlock === undefined || start < firstUnsettledBlock) {
      firstUnsettledBlock = start;
    }
  }
  if (settledMax === undefined) return undefined;
  if (firstUnsettledBlock === undefined) return settledMax;
  const clamped = Math.min(settledMax, firstUnsettledBlock - 1);
  return clamped < 0 ? undefined : clamped;
}

// ---------------------------------------------------------------------------
// On-chain cursor recovery
// ---------------------------------------------------------------------------

/** CC3's public RPC enforces a 10 s query timeout, so log windows must stay modest. */
export const CC3_LOG_WINDOW = 10_000;
const CC3_LOG_WINDOW_MIN = 500;

export function isRetryableLogError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return /timeout|too many results|response size|limit exceeded|range/i.test(msg);
}

/**
 * One `queryFilter` window, halving the span and retrying when the node complains about
 * timeouts or result size. Returns the logs plus the window size that actually worked.
 */
async function queryLogsAdaptive(
  contract: Contract,
  filter: unknown,
  start: number,
  end: number,
  onShrink?: (span: number, err: Error) => void,
): Promise<{ logs: unknown[]; windowSize: number }> {
  let from = start;
  let span = end - start + 1;
  const collected: unknown[] = [];
  while (from <= end) {
    const to = Math.min(end, from + span - 1);
    try {
      collected.push(...(await contract.queryFilter(filter as never, from, to)));
      from = to + 1;
    } catch (e) {
      if (!isRetryableLogError(e) || span <= CC3_LOG_WINDOW_MIN) throw e;
      span = Math.max(CC3_LOG_WINDOW_MIN, Math.floor(span / 2));
      onShrink?.(span, e as Error);
    }
  }
  return { logs: collected, windowSize: span };
}

/**
 * Highest `sourceBlock` in a RootRelayed event, found by walking CC3 backwards in windows.
 * Returns undefined when the contract has never relayed anything.
 *
 * `fromBlock` should be the contract's deployment block: without it the walk trawls millions
 * of blocks that cannot contain the event, and CC3's 10 s query timeout starts rejecting
 * windows. `scanForWork` derives it from the deployment file's `txHashes`.
 */
export async function lastRelayedSourceBlock(
  provider: JsonRpcProvider,
  address: string,
  opts: { windowSize?: number; maxLookback?: number; fromBlock?: number } = {},
): Promise<number | undefined> {
  const contract = attestedWorldId(address, provider);
  const head = await provider.getBlockNumber();
  let windowSize = opts.windowSize ?? CC3_LOG_WINDOW;
  const maxLookback = opts.maxLookback ?? 2_000_000;
  const floor = Math.max(0, opts.fromBlock ?? head - maxLookback);
  const filter = contract.filters.RootRelayed!();
  for (let end = head; end >= floor; end -= windowSize) {
    const start = Math.max(floor, end - windowSize + 1);
    const res = await queryLogsAdaptive(contract, filter, start, end, (span) => {
      windowSize = span;
    });
    windowSize = Math.min(windowSize, res.windowSize);
    let best = 0;
    for (const log of res.logs) {
      const sourceBlock = Number((log as { args?: unknown[] }).args?.[1] ?? 0);
      if (sourceBlock > best) best = sourceBlock;
    }
    if (best > 0) return best;
    if (start === floor) break;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface RelayContext {
  source: SourceConfig;
  cc3: JsonRpcProvider;
  signer?: Wallet;
  contractAddress?: string;
  store?: RelayStore;
  dryRun: boolean;
  /** Do not wait for attestation; skip anything not yet attested. */
  noWait?: boolean;
  log: (msg: string) => void;
  evidenceFile?: string;
  confirmations?: number;
  /** Source-chain reader with RPC failover; created lazily when absent. */
  logs?: LogSource;
  /**
   * Resolved once per run by `finalityDepth()`: the deployed contract's `FINALITY_DEPTH()`
   * immutable, or the source default when no deployment is reachable.
   */
  resolvedFinalityDepth?: number;
  /** CC3 block the AttestedWorldID was deployed in; floor for RootRelayed scans. */
  deploymentBlock?: number;
  /** Deploy transaction hash from the deployments file, used to derive the block above. */
  deploymentTxHash?: string;
}

/**
 * CC3 block the contract was deployed in, from the deployments file's `txHashes`. Bounds
 * the RootRelayed scan to blocks that could actually contain the event — without it the
 * walk covers millions of empty blocks and CC3's 10 s query timeout rejects the windows.
 */
export async function deploymentBlock(ctx: RelayContext): Promise<number | undefined> {
  if (ctx.deploymentBlock !== undefined) return ctx.deploymentBlock;
  if (!ctx.deploymentTxHash) return undefined;
  try {
    const receipt = await ctx.cc3.getTransactionReceipt(ctx.deploymentTxHash);
    if (receipt?.blockNumber !== undefined) {
      ctx.deploymentBlock = receipt.blockNumber;
      return receipt.blockNumber;
    }
  } catch (e) {
    ctx.log(`  could not resolve the deployment block: ${(e as Error).message.slice(0, 80)}`);
  }
  return undefined;
}

/**
 * The finality depth the contract will actually enforce. `FINALITY_DEPTH` is a constructor
 * immutable (`contracts/src/AttestedWorldID.sol`), so a deployment may use any value; the
 * hard-coded 32 in `SOURCES` is only a fallback for when no address is available yet.
 * Memoised on the context so one relay pass reads it at most once per source.
 */
export async function finalityDepth(ctx: RelayContext): Promise<number> {
  if (ctx.resolvedFinalityDepth !== undefined) return ctx.resolvedFinalityDepth;
  const fallback = ctx.source.finalityDepth;
  if (ctx.contractAddress) {
    try {
      const raw = await attestedWorldId(ctx.contractAddress, ctx.cc3).FINALITY_DEPTH!();
      const depth = Number(raw);
      if (Number.isInteger(depth) && depth >= 0) {
        if (depth !== fallback) {
          ctx.log(`  ${ctx.source.name}: FINALITY_DEPTH() = ${depth} (default was ${fallback})`);
        }
        ctx.resolvedFinalityDepth = depth;
        return depth;
      }
      ctx.log(`  FINALITY_DEPTH() returned ${raw}; using the default ${fallback}`);
    } catch (e) {
      ctx.log(
        `  could not read FINALITY_DEPTH() (${(e as Error).message.slice(0, 80)}); using ${fallback}`,
      );
    }
  }
  ctx.resolvedFinalityDepth = fallback;
  return fallback;
}

export function sourceLogs(ctx: RelayContext): LogSource {
  if (!ctx.logs) ctx.logs = new LogSource(ctx.source);
  return ctx.logs;
}

export interface BatchOutcome {
  txHashes: string[];
  blockRange: [number, number];
  mode: "batch" | "single";
  calldataBytes: number;
  verified: boolean | null;
  submitted: boolean;
  cc3TxHash?: string;
  gasUsed?: bigint;
  status: "relayed" | "dry-run" | "already" | "skipped" | "failed";
  error?: string;
}

/** True when the contract already recorded this query. */
export async function isProcessed(
  contract: Contract,
  chainKey: number,
  blockHeight: number,
  txIndex: number,
): Promise<boolean> {
  const queryId = computeQueryId(chainKey, blockHeight, txIndex);
  return (await contract.processedQueries!(queryId)) as boolean;
}

/** Waits for the prover service and then for the on-chain attested tip + finality depth. */
export async function waitAttested(
  ctx: RelayContext,
  targetHeight: number,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ attestedTip: number; final: boolean }> {
  const builder = proofBuilder(ctx.source.chainKey);
  const info = chainInfoProvider(ctx.cc3);
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const pollMs = opts.pollMs ?? 15_000;

  if (!ctx.noWait) {
    await builder.waitUntilHeightAttested(ctx.source.chainKey, targetHeight, pollMs, timeoutMs);
  }

  const depth = await finalityDepth(ctx);
  const needed = targetHeight + depth;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { height } = await info.getLatestAttestedHeightAndHash(ctx.source.chainKey);
    if (height >= needed) return { attestedTip: height, final: true };
    if (ctx.noWait || Date.now() > deadline) return { attestedTip: height, final: false };
    ctx.log(
      `  waiting for finality: attested tip ${height}, need ${needed} (block ${targetHeight} + depth ${depth})`,
    );
    await Bun.sleep(pollMs);
  }
}

/** Fetches a batch proof, falling back to one proof per transaction. */
export async function obtainProofs(
  ctx: RelayContext,
  txs: SourceTx[],
  opts: { forceSingle?: boolean } = {},
): Promise<{ mode: "batch" | "single"; batches: NormalizedBatchProof[] }> {
  const builder = proofBuilder(ctx.source.chainKey);
  const hashes = txs.map((t) => t.txHash);
  if (hashes.length > 1 && !opts.forceSingle) {
    try {
      const batch = await fetchBatchProof(builder, hashes);
      return { mode: "batch", batches: [batch] };
    } catch (e) {
      ctx.log(`  getBatchProof failed (${(e as Error).message}); falling back to per-tx proofs`);
    }
  }
  const singles: NormalizedBatchProof[] = [];
  for (const tx of txs) {
    singles.push(singleToBatch(await fetchProof(builder, tx.txHash)));
  }
  return { mode: "single", batches: singles };
}

/**
 * The `SourceTx` entries behind one batch's members, in batch order. Used to refetch proofs
 * for exactly the submission in flight — never for the whole scan group, which would let a
 * stale-proof retry on one member escalate into a batch over already-relayed members.
 */
export function membersAsSourceTxs(
  batch: NormalizedBatchProof,
  group: readonly SourceTx[],
): SourceTx[] {
  const byHash = new Map(group.map((g) => [g.txHash.toLowerCase(), g]));
  return batch.members.map(
    (m) =>
      byHash.get(m.txHash.toLowerCase()) ?? {
        txHash: m.txHash,
        blockNumber: m.blockHeight,
        txIndex: m.txIndex,
        logIndex: 0,
        preRoot: 0n,
        kind: 0,
        postRoot: 0n,
      },
  );
}

/** Reproduces the AttestedWorldID guards 1-6 for every member; throws on a permanent mismatch. */
export function inspectBatch(ctx: RelayContext, batch: NormalizedBatchProof): LocalInspection[] {
  return batch.members.map((m) =>
    inspectLocally(m.txBytes, {
      chainKey: batch.chainKey,
      sourceChainKey: ctx.source.chainKey,
      manager: ctx.source.manager,
    }),
  );
}

/** Read-only precompile verification (verifySingle / verifyBatch). */
export async function verifyReadOnly(
  ctx: RelayContext,
  batch: NormalizedBatchProof,
): Promise<boolean> {
  const prover = blockProverClient(ctx.cc3);
  if (batch.members.length === 1) {
    const m = batch.members[0]!;
    return prover.verifySingle(
      batch.chainKey,
      m.blockHeight,
      m.txBytes,
      m.merkleProof as never,
      batch.continuityProof as never,
    );
  }
  return prover.verifyBatch(
    batch.chainKey,
    batch.members.map((m) => m.blockHeight),
    batch.members.map((m) => m.txBytes),
    batch.members.map((m) => m.merkleProof) as never,
    batch.continuityProof as never,
  );
}

/** Encodes the exact calldata that would be sent, without sending it. */
export function encodeCalldata(batch: NormalizedBatchProof): { data: string; fn: string } {
  const iface = loadAttestedWorldIdAbi().iface;
  if (batch.members.length === 1) {
    const m = batch.members[0]!;
    const proof: SingleProof = {
      chainKey: batch.chainKey,
      headerNumber: m.blockHeight,
      txIndex: m.txIndex,
      txHash: m.txHash,
      txBytes: m.txBytes,
      merkleProof: m.merkleProof,
      continuityProof: batch.continuityProof,
    };
    return { fn: "execute", data: iface.encodeFunctionData("execute", toExecuteArgs(proof)) };
  }
  return {
    fn: "executeBatch",
    data: iface.encodeFunctionData("executeBatch", toExecuteBatchArgs(batch)),
  };
}

export function calldataBytes(data: string): number {
  return (data.length - 2) / 2;
}

export { normalizeBatchProof };

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface ScanResult {
  from: number;
  to: number;
  head: number;
  /** Source height attested on CC3 (ChainInfo 0x0FD3). */
  attestedTip: number;
  /** The finality depth actually in force (from the contract when deployed). */
  finalityDepth: number;
  txs: SourceTx[];
}

/**
 * Highest source block that could satisfy the on-chain finality guard right now:
 * the contract needs `attestedTip >= blockHeight + FINALITY_DEPTH`.
 */
export function finalScanCeiling(head: number, attestedTip: number, finalityDepth: number): number {
  return Math.min(head, attestedTip - finalityDepth);
}

export async function scanForWork(
  ctx: RelayContext,
  opts: { fromFlag?: number; headOffset?: number } = {},
): Promise<ScanResult> {
  const logs = sourceLogs(ctx);
  const onFailover = (url: string, err: Error) =>
    ctx.log(`  rpc ${url} failed (${err.message.slice(0, 90)}); trying the next endpoint`);
  const head = await logs.getBlockNumber(onFailover);
  let attestedTip = head;
  try {
    attestedTip = (await chainInfoProvider(ctx.cc3).getLatestAttestedHeightAndHash(
      ctx.source.chainKey,
    )).height;
  } catch (e) {
    ctx.log(`  could not read attested tip: ${(e as Error).message}`);
  }

  let lastRelayed: number | undefined;
  if (ctx.contractAddress) {
    try {
      lastRelayed = await lastRelayedSourceBlock(ctx.cc3, ctx.contractAddress, {
        fromBlock: await deploymentBlock(ctx),
      });
    } catch (e) {
      // Before the first root lands, the contract has no history to read — that is an
      // empty cursor, not an error. `deriveCursor` then falls back to the lookback window.
      if (isNoRootsSeen(e)) {
        ctx.log(`  ${ctx.source.name}: not bootstrapped yet (0 roots) — no on-chain cursor`);
      } else {
        ctx.log(`  could not read RootRelayed history: ${(e as Error).message}`);
      }
    }
  }

  const from = deriveCursor({
    storeCursor: ctx.store?.getCursor(ctx.source.name),
    lastRelayedBlock: lastRelayed,
    fromFlag: opts.fromFlag,
    fallback: Math.max(0, head - DEFAULT_LOOKBACK_BLOCKS),
  });
  // Never scan past what the finality guard could accept — it would only produce
  // transactions that must sit pending, and would block `--once` runs waiting.
  const depth = await finalityDepth(ctx);
  const ceiling = finalScanCeiling(head, attestedTip, depth);
  const to = Math.max(from - 1, ceiling - (opts.headOffset ?? 0));

  const txs =
    to < from
      ? []
      : await scanTreeChanged({
          logs,
          manager: ctx.source.manager,
          fromBlock: from,
          toBlock: to,
          windowSize: LOG_WINDOW,
          onFailover,
        });
  return { from, to, head, attestedTip, finalityDepth: depth, txs };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function sendBatch(
  ctx: RelayContext,
  contract: Contract,
  batch: NormalizedBatchProof,
): Promise<{ cc3TxHash: string; gasUsed: bigint; logs: readonly unknown[]; cc3Block: number }> {
  const fn = batch.members.length === 1 ? "execute" : "executeBatch";
  const args =
    batch.members.length === 1
      ? toExecuteArgs({
          chainKey: batch.chainKey,
          headerNumber: batch.members[0]!.blockHeight,
          txIndex: batch.members[0]!.txIndex,
          txHash: batch.members[0]!.txHash,
          txBytes: batch.members[0]!.txBytes,
          merkleProof: batch.members[0]!.merkleProof,
          continuityProof: batch.continuityProof,
        })
      : toExecuteBatchArgs(batch);

  const callArgs = args as unknown as unknown[];
  const gasEstimate = (await contract[fn]!.estimateGas(...callArgs)) as bigint;
  const gasLimit = (gasEstimate * 130n) / 100n;
  ctx.log(`  gas estimate ${gasEstimate} (limit ${gasLimit})`);
  const tx = await contract[fn]!(...callArgs, { gasLimit });
  ctx.log(`  submitted ${tx.hash}`);
  const receipt = await tx.wait(ctx.confirmations ?? 1);
  if (!receipt) throw new Error(`no receipt for ${tx.hash}`);
  if (receipt.status !== 1) throw new Error(`relay tx ${tx.hash} reverted on CC3`);
  return {
    cc3TxHash: receipt.hash,
    gasUsed: receipt.gasUsed,
    logs: receipt.logs,
    cc3Block: receipt.blockNumber,
  };
}

export interface ProcessOptions {
  fromFlag?: number;
  maxBatches?: number;
  evidence?: boolean;
}

/** Relays everything currently pending for one source. Returns one outcome per batch. */
export async function relaySourceOnce(
  ctx: RelayContext,
  opts: ProcessOptions = {},
): Promise<BatchOutcome[]> {
  const scan = await scanForWork(ctx, { fromFlag: opts.fromFlag });
  ctx.log(
    `${ctx.source.name}: blocks ${scan.from}..${scan.to} (head ${scan.head}, attested tip ${scan.attestedTip}, finality depth ${scan.finalityDepth}) — ${scan.txs.length} TreeChanged tx(s)`,
  );
  if (scan.txs.length === 0) {
    ctx.store?.advanceCursor(ctx.source.name, scan.to + 1);
    return [];
  }

  for (const tx of scan.txs) {
    ctx.store?.upsertPending(ctx.source.name, tx.txHash, tx.blockNumber, tx.txIndex);
  }

  // Skip anything already recorded on-chain (replay protection, cheap read).
  const contractRead = ctx.contractAddress
    ? attestedWorldId(ctx.contractAddress, ctx.cc3)
    : undefined;
  const todo: SourceTx[] = [];
  for (const tx of scan.txs) {
    if (ctx.store?.isSettled(ctx.source.name, tx.txHash)) continue;
    if (contractRead) {
      try {
        if (await isProcessed(contractRead, ctx.source.chainKey, tx.blockNumber, tx.txIndex)) {
          ctx.log(`  ${tx.txHash} already processed on-chain, skipping`);
          ctx.store?.markStatus(ctx.source.name, tx.txHash, "already");
          continue;
        }
      } catch (e) {
        ctx.log(`  processedQueries read failed (${(e as Error).message}); will let the tx decide`);
      }
    }
    todo.push(tx);
  }

  const batches = groupIntoBatches(todo);
  const outcomes: BatchOutcome[] = [];
  const limit = opts.maxBatches ?? batches.length;

  for (const group of batches.slice(0, limit)) {
    outcomes.push(...(await processBatch(ctx, group, opts)));
  }

  // Advance the cursor only across the leading run of settled batches. Stopping at the
  // first unsettled batch is what makes "never skip" true: a failure keeps every later
  // block in scope for the next pass instead of being scanned past.
  const advanceTo = settledThrough(outcomes);
  if (advanceTo !== undefined) {
    ctx.store?.advanceCursor(ctx.source.name, advanceTo + 1);
  } else if (todo.length === 0) {
    ctx.store?.advanceCursor(ctx.source.name, scan.to + 1);
  }
  return outcomes;
}

/** Relays one group of source transactions. Returns one outcome per submitted call. */
async function processBatch(
  ctx: RelayContext,
  group: SourceTx[],
  opts: ProcessOptions,
): Promise<BatchOutcome[]> {
  const minBlock = group[0]!.blockNumber;
  const maxBlock = group[group.length - 1]!.blockNumber;
  const hashes = group.map((t) => t.txHash);
  const base: BatchOutcome = {
    txHashes: hashes,
    blockRange: [minBlock, maxBlock],
    mode: group.length > 1 ? "batch" : "single",
    calldataBytes: 0,
    verified: null,
    submitted: false,
    status: "failed",
  };

  ctx.log(`→ ${group.length} tx(s), blocks ${minBlock}..${maxBlock} (span ${maxBlock - minBlock})`);

  try {
    const att = await waitAttested(ctx, maxBlock);
    if (!att.final) {
      ctx.log(`  not final yet (attested tip ${att.attestedTip}); leaving pending`);
      for (const h of hashes) ctx.store?.markStatus(ctx.source.name, h, "pending");
      return [{ ...base, status: "skipped", error: `attested tip ${att.attestedTip}` }];
    }

    const { mode, batches } = await obtainProofs(ctx, group);
    const outcomes: BatchOutcome[] = [];
    for (const batch of batches) {
      outcomes.push(await submitBatch(ctx, batch, group, opts, mode));
    }

    // A whole-batch submission that failed gets one more chance as individual calls, so a
    // single bad member cannot take the rest of the group down with it.
    const batchFailed =
      mode === "batch" && outcomes.length === 1 && outcomes[0]!.status === "failed";
    if (batchFailed && !ctx.dryRun && group.length > 1) {
      ctx.log("  batch submission failed; retrying as individual transactions");
      const per = await obtainProofs(ctx, group, { forceSingle: true });
      const retried: BatchOutcome[] = [];
      for (const single of per.batches) {
        retried.push(await submitBatch(ctx, single, group, opts, "single"));
      }
      return retried;
    }
    return outcomes;
  } catch (e) {
    const msg = (e as Error).message;
    ctx.log(`  batch failed: ${msg}`);
    for (const h of hashes) {
      ctx.store?.markStatus(ctx.source.name, h, "failed", { error: msg, bumpAttempts: true });
    }
    return [{ ...base, status: "failed", error: msg }];
  }
}

/**
 * Local guard replay → calldata encode → read-only precompile verify → submit (unless dry
 * run) → retry policy → evidence. Exported so `prove` can drive a single transaction
 * through exactly the same path the continuous relay uses.
 */
export async function submitBatch(
  ctx: RelayContext,
  batch: NormalizedBatchProof,
  group: SourceTx[],
  opts: ProcessOptions,
  mode: "batch" | "single",
): Promise<BatchOutcome> {
  const hashes = batch.members.map((m) => m.txHash);
  const blocks = batch.members.map((m) => m.blockHeight);
  const outcome: BatchOutcome = {
    txHashes: hashes,
    blockRange: [Math.min(...blocks), Math.max(...blocks)],
    mode,
    calldataBytes: 0,
    verified: null,
    submitted: false,
    status: "failed",
  };

  // Local guard replay: catches decoy logs / reverted source txs before spending gas.
  const inspections = inspectBatch(ctx, batch);
  for (const [i, ins] of inspections.entries()) {
    if (!ins.ok) {
      const bad = ins.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`);
      const msg = `local guard replay failed for ${hashes[i]}: ${bad.join("; ")}`;
      ctx.log(`  ${msg}`);
      ctx.store?.markStatus(ctx.source.name, hashes[i]!, "failed", {
        error: msg,
        bumpAttempts: true,
      });
      return { ...outcome, error: msg };
    }
  }

  const { data, fn } = encodeCalldata(batch);
  outcome.calldataBytes = calldataBytes(data);
  ctx.log(`  ${fn} calldata ${outcome.calldataBytes} bytes`);

  outcome.verified = await verifyReadOnly(ctx, batch);
  ctx.log(`  precompile ${batch.members.length === 1 ? "verifySingle" : "verifyBatch"}: ${outcome.verified}`);
  if (!outcome.verified) {
    const msg = "read-only precompile verification returned false";
    for (const h of hashes) {
      ctx.store?.markStatus(ctx.source.name, h, "failed", { error: msg, bumpAttempts: true });
    }
    return { ...outcome, error: msg };
  }

  if (ctx.dryRun) {
    ctx.log("  dry run: not sending the transaction");
    return { ...outcome, status: "dry-run" };
  }
  if (!ctx.contractAddress || !ctx.signer) {
    return { ...outcome, status: "skipped", error: "no deployment / signer" };
  }

  const contract = attestedWorldId(ctx.contractAddress, ctx.signer);
  let submitted = batch;
  const res = await executeWithRetry(batch, {
    send: async (b) => {
      submitted = b;
      return sendBatch(ctx, contract, b);
    },
    refetch: async () => {
      // Only the transactions in THIS submission, so a retry cannot pull in members that
      // were already relayed earlier in the same pass (duplicate evidence + wrong status).
      const subgroup = membersAsSourceTxs(batch, group);
      ctx.log(`  refetching proof for ${subgroup.length} tx(s) and retrying once`);
      const fresh = await obtainProofs(ctx, subgroup, { forceSingle: subgroup.length === 1 });
      if (fresh.batches.length !== 1) {
        // getBatchProof degraded to per-tx proofs; submitting batches[0] would silently
        // relay a subset. Fail loudly instead — the transactions stay recorded, not dropped.
        throw new Error(
          `refetch produced ${fresh.batches.length} proofs for a ${subgroup.length}-tx submission; not retrying`,
        );
      }
      return fresh.batches[0]!;
    },
    reasonOf: revertReason,
    onRevert: (reason, cls, action) => ctx.log(`  revert (${cls} → ${action}): ${reason}`),
  });

  if (res.kind === "success") {
    await recordSuccess(ctx, submitted, group, res.result, opts);
    return {
      ...outcome,
      submitted: true,
      cc3TxHash: res.result.cc3TxHash,
      gasUsed: res.result.gasUsed,
      status: "relayed",
    };
  }
  if (res.kind === "already") {
    for (const h of hashes) ctx.store?.markStatus(ctx.source.name, h, "already");
    return { ...outcome, status: "already", error: res.reason };
  }
  // pending and failed both keep the transaction in the table — never dropped.
  const status: TxStatus = res.kind === "pending" ? "pending" : "failed";
  for (const h of hashes) {
    ctx.store?.markStatus(ctx.source.name, h, status, { error: res.reason, bumpAttempts: true });
  }
  return { ...outcome, status: res.kind === "pending" ? "skipped" : "failed", error: res.reason };
}

export interface RelayedRoot {
  sourceBlock: number;
  sourceTxIndex: number;
  preRoot: bigint;
  postRoot: bigint;
  kind: number;
  humansAdded: number;
}

/**
 * A batch can relay two transactions from the same source block, so `sourceBlock` alone is
 * not a key — one evidence line would otherwise carry the other transaction's roots.
 * `sourceTxIndex` (RootRelayed arg 6) disambiguates them.
 */
export function relayedKey(sourceBlock: number, sourceTxIndex: number): string {
  return `${sourceBlock}:${sourceTxIndex}`;
}

/** Indexes the RootRelayed events in a CC3 receipt by (sourceBlock, sourceTxIndex). */
export function parseRootRelayed(logs: readonly unknown[]): Map<string, RelayedRoot> {
  const iface = loadAttestedWorldIdAbi().iface;
  const out = new Map<string, RelayedRoot>();
  for (const raw of logs) {
    try {
      const parsed = iface.parseLog(raw as never);
      if (parsed?.name !== "RootRelayed") continue;
      const sourceBlock = Number(parsed.args[1]);
      const sourceTxIndex = Number(parsed.args[6]);
      out.set(relayedKey(sourceBlock, sourceTxIndex), {
        sourceBlock,
        sourceTxIndex,
        preRoot: BigInt(parsed.args[3]),
        postRoot: BigInt(parsed.args[2]),
        kind: Number(parsed.args[4]),
        humansAdded: Number(parsed.args[5]),
      });
    } catch {
      /* not one of ours */
    }
  }
  return out;
}

async function recordSuccess(
  ctx: RelayContext,
  batch: NormalizedBatchProof,
  group: SourceTx[],
  res: { cc3TxHash: string; gasUsed: bigint; logs: readonly unknown[]; cc3Block: number },
  opts: ProcessOptions,
): Promise<void> {
  const relayed = parseRootRelayed(res.logs);

  // Attestation lag is measured end to end: source block timestamp → CC3 inclusion timestamp.
  let landedAtSec = Math.floor(Date.now() / 1000);
  try {
    const block = await ctx.cc3.getBlock(res.cc3Block);
    if (block?.timestamp) landedAtSec = block.timestamp;
  } catch {
    /* best effort */
  }
  const logs = sourceLogs(ctx);

  for (const member of batch.members) {
    const src = group.find((g) => g.txHash.toLowerCase() === member.txHash.toLowerCase());
    const ev = relayed.get(relayedKey(member.blockHeight, member.txIndex));
    const inspection = inspectLocally(member.txBytes, {
      chainKey: batch.chainKey,
      sourceChainKey: ctx.source.chainKey,
      manager: ctx.source.manager,
    });

    let lag: number | null = null;
    try {
      const block = await logs.getBlock(member.blockHeight);
      if (block?.timestamp) lag = landedAtSec - block.timestamp;
    } catch {
      /* best effort */
    }

    ctx.store?.markStatus(ctx.source.name, member.txHash, "done", { cc3TxHash: res.cc3TxHash });

    if (opts.evidence !== false) {
      const line = appendEvidence(
        {
          source: ctx.source.name,
          txHash: member.txHash,
          sourceBlock: member.blockHeight,
          txIndex: member.txIndex,
          preRoot: ev?.preRoot ?? inspection.change?.preRoot ?? src?.preRoot ?? 0n,
          postRoot: ev?.postRoot ?? inspection.change?.postRoot ?? src?.postRoot ?? 0n,
          kind: ev?.kind ?? inspection.change?.kind ?? src?.kind ?? 0,
          humansAdded: ev?.humansAdded ?? inspection.call?.humansAdded ?? 0,
          cc3TxHash: res.cc3TxHash,
          gasUsed: res.gasUsed,
          attestationLagSec: lag,
          contract: ctx.contractAddress ?? null,
        },
        ctx.evidenceFile,
      );
      ctx.log(
        `  relayed root ${line.postRoot.slice(0, 18)}… (+${line.humansAdded} humans, lag ${line.attestationLagSec}s)`,
      );
    }
  }
}
