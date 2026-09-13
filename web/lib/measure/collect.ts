/**
 * Collect every published measurement from the live chains. Network-heavy; run by
 * `bun run worker/src/cli.ts measure`, which writes `evidence/measurements.json` and regenerates the
 * tables in `docs/MEASUREMENTS.md`.
 *
 *  1. relay transactions   every `RootRelayed` on both relays: gas, calldata, roots per tx, latency
 *  2. batch gas probe      gas for 1..k consecutive real Sepolia updates, on a fresh copy of the live
 *                          relay bytecode (state override) measured by `GasProbe`
 *  3. anchors              ChainInfo attestation vs checkpoint reads, and 0x0FD2 verify gas by anchor
 *  4. the cap              10 passes the size check, 11 does not; gas at 10 against the block limit
 *  5. precompile usage     which contracts call 0x0FD2 over the scanned window, and Humanline's share
 */

import {
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { attestedWorldIdAbi, nativeQueryVerifierAbi, relayRewardAbi } from "../abi";
import { decodeRefusal, TREE_CHANGED_TOPIC } from "../attacks/core";
import {
  normalizeBatch,
  normalizeSingle,
  toExecuteBatchArgs,
  type BatchProofJson,
  type ExecuteBatchArgs,
  type NormalizedBatch,
  type SingleProofJson,
} from "../relay/proof";
import { GAS_PROBE_ADDRESS, GAS_PROBE_CODE, RELAY_COPY_ADDRESS } from "./probe-code";
import { byteLength, histogram, intrinsicGas, ols, ols2, summarize, type Fit, type Fit2, type Summary } from "./stats";

const CHAIN_INFO: Address = "0x0000000000000000000000000000000000000fD3";
const BLOCK_PROVER: Address = "0x0000000000000000000000000000000000000FD2";
const CC3_LOG_WINDOW = 5_000n;

export type RelayInstance = { name: "sepolia" | "mainnet"; chainKey: number; address: Address; deployBlock: bigint; sourceRpc: string };

export type CollectOptions = {
  cc3Rpc: string;
  proverUrl: string;
  relays: RelayInstance[];
  vault: Address;
  /** Every Humanline contract address, for the precompile-share scan. */
  humanline: Address[];
  identityManagerSepolia: Address;
  /** CC3 blocks scanned for 0x0FD2 usage, counting back from head. */
  precompileScanBlocks?: number;
  /** Real proofs whose 0x0FD2 verify gas is measured, labelled by anchor. */
  proofs: SingleProofJson[];
  log?: (line: string) => void;
};

export type RelayTxRecord = {
  hash: Hex;
  relay: "sepolia" | "mainnet";
  via: "direct" | "vault" | "other";
  roots: number;
  members: number | null;
  gasUsed: number;
  calldataBytes: number;
  continuityRoots: number | null;
  txBytes: number[];
  cc3Block: number;
  cc3Time: number;
  sourceBlocks: number[];
  /** Seconds from the source block to its root landing on CC3, per root. */
  latencies: number[];
};

export type ProbePoint = {
  n: number;
  ok: boolean;
  executionGas: number;
  txGas: number;
  calldataBytes: number;
  continuityRoots: number;
  error?: string;
  fromBlock: number;
  toBlock: number;
};

export type Measurements = {
  generatedAt: string;
  cc3: { chainId: number; head: number; blockGasLimit: number };
  relayTxs: RelayTxRecord[];
  gasByBatchSize: Array<{ n: number; observed: number; min: number; median: number; max: number }>;
  liveFit: Fit | null;
  /** gasUsed ≈ intercept + b1 · members + b2 · continuity roots, over direct relays. */
  liveModel: Fit2 | null;
  probe: { points: ProbePoint[]; fit: Fit | null; model: Fit2 | null; note: string };
  anchors: {
    attestationReadGas: number | null;
    checkpointReadGas: number | null;
    verify: Array<{ txHash: string; chainKey: number; anchor: "attestation" | "checkpoint" | "unknown"; continuityRoots: number; gas: number | null; ok: boolean }>;
    /** 0x0FD2 `verify` gas against continuity roots. */
    verifyFit: Fit | null;
  };
  cap: { tenError: string | null; elevenError: string | null; projectedGasAt10: number | null; headroomAt10: number | null };
  latency: { summary: Summary | null; spanHours: number; byRelay: Record<string, Summary | null>; series: Array<{ at: number; relay: string; seconds: number }> };
  proofSizes: { calldata: Summary | null; txBytes: Summary | null; continuityRoots: Summary | null; histogram: Array<{ from: number; to: number; count: number }> };
  precompile: { fromBlock: number; toBlock: number; hours: number; logs: number; txs: number; callers: Array<{ to: string; txs: number; humanline: boolean }>; humanlineTxs: number; humanlineShare: number };
};

const median = (v: number[]) => summarize(v)?.p50 ?? 0;

async function pooled<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

/** Decode relay calldata into its batch arguments, whether sent directly or through the vault. */
export function decodeRelayInput(input: Hex): { via: "direct" | "vault"; args: ExecuteBatchArgs } | null {
  try {
    const d = decodeFunctionData({ abi: attestedWorldIdAbi, data: input });
    if (d.functionName === "executeBatch") return { via: "direct", args: d.args as unknown as ExecuteBatchArgs };
  } catch {
    /* not a direct relay */
  }
  try {
    const d = decodeFunctionData({ abi: relayRewardAbi, data: input });
    if (d.functionName === "relay") {
      const [, chainKey, heights, txs, merkles, continuity] = d.args as unknown as [Address, ...ExecuteBatchArgs];
      return { via: "vault", args: [chainKey, heights, txs, merkles, continuity] as unknown as ExecuteBatchArgs };
    }
  } catch {
    /* not a vault relay */
  }
  return null;
}

/** Wrap a call for `GasProbe`: `abi.encode(target, data)`. */
export function probeInput(target: Address, data: Hex): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [target, data]);
}

export function decodeProbeOutput(output: Hex): { ok: boolean; gas: number; ret: Hex } {
  const [ok, used, ret] = decodeAbiParameters([{ type: "bool" }, { type: "uint256" }, { type: "bytes" }], output);
  return { ok, gas: Number(used), ret };
}

async function probe(client: PublicClient, target: Address, data: Hex, overrides: Array<{ address: Address; code: Hex }> = []) {
  const result = await client.call({
    to: GAS_PROBE_ADDRESS,
    data: probeInput(target, data),
    gas: 70_000_000n,
    stateOverride: [{ address: GAS_PROBE_ADDRESS, code: GAS_PROBE_CODE }, ...overrides],
  });
  return decodeProbeOutput(result.data ?? "0x");
}

async function proofFor(proverUrl: string, chainKey: number, hashes: string[]): Promise<NormalizedBatch> {
  if (hashes.length === 1) {
    const r = await fetch(`${proverUrl}/api/v1/proof-by-tx/${chainKey}/${hashes[0]}`, { signal: AbortSignal.timeout(180_000) });
    if (!r.ok) throw new Error(`prover HTTP ${r.status}`);
    return normalizeSingle((await r.json()) as SingleProofJson, hashes[0]);
  }
  const r = await fetch(`${proverUrl}/api/v1/proof-batch-by-tx/${chainKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(hashes),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`prover HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return normalizeBatch((await r.json()) as BatchProofJson, hashes);
}

/** The densest run of consecutive updates that fits one batch proof (≤ span blocks, ≤ max txs). */
export function densestWindow<T extends { block: number }>(items: readonly T[], span = 1_000, max = 10): T[] {
  let best: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const start = items[i]!.block;
    const window: T[] = [];
    for (let j = i; j < items.length && window.length < max && items[j]!.block - start < span; j += 1) window.push(items[j]!);
    if (window.length > best.length) best = window;
  }
  return best;
}

export async function collectMeasurements(o: CollectOptions): Promise<Measurements> {
  const log = o.log ?? (() => {});
  const cc3 = createPublicClient({ transport: http(o.cc3Rpc, { timeout: 60_000, retryCount: 3, batch: { batchSize: 50 } }) });
  const [head, latest] = await Promise.all([cc3.getBlockNumber(), cc3.getBlock()]);
  const humanline = new Set(o.humanline.map((a) => a.toLowerCase()));

  // ------------------------------------------------------------------ 1. relay transactions
  const relayTxs: RelayTxRecord[] = [];
  for (const relay of o.relays) {
    const source = createPublicClient({ transport: http(relay.sourceRpc, { timeout: 30_000, retryCount: 3 }) });
    const events: Array<{ tx: Hex; sourceBlock: bigint; cc3Block: bigint }> = [];
    for (let from = relay.deployBlock; from <= head; from += CC3_LOG_WINDOW) {
      const to = from + CC3_LOG_WINDOW - 1n < head ? from + CC3_LOG_WINDOW - 1n : head;
      const got = await cc3.getContractEvents({ address: relay.address, abi: attestedWorldIdAbi, eventName: "RootRelayed", fromBlock: from, toBlock: to });
      for (const e of got) {
        events.push({ tx: e.transactionHash!, sourceBlock: (e.args as { sourceBlock: bigint }).sourceBlock, cc3Block: e.blockNumber! });
      }
    }
    const byTx = new Map<Hex, typeof events>();
    for (const e of events) byTx.set(e.tx, [...(byTx.get(e.tx) ?? []), e]);
    const sourceTimes = new Map<bigint, number>();
    await pooled([...new Set(events.map((e) => e.sourceBlock))], 8, async (b) => {
      sourceTimes.set(b, Number((await source.getBlock({ blockNumber: b })).timestamp));
    });
    const records = await pooled([...byTx.entries()], 8, async ([hash, evs]): Promise<RelayTxRecord> => {
      const [tx, receipt, block] = await Promise.all([
        cc3.getTransaction({ hash }),
        cc3.getTransactionReceipt({ hash }),
        cc3.getBlock({ blockNumber: evs[0]!.cc3Block }),
      ]);
      const decoded = decodeRelayInput(tx.input);
      const to = tx.to?.toLowerCase();
      const via = decoded?.via ?? (to === relay.address.toLowerCase() ? "direct" : to === o.vault.toLowerCase() ? "vault" : "other");
      const cc3Time = Number(block.timestamp);
      return {
        hash,
        relay: relay.name,
        via,
        roots: evs.length,
        members: decoded ? decoded.args[1].length : null,
        gasUsed: Number(receipt.gasUsed),
        calldataBytes: byteLength(tx.input),
        continuityRoots: decoded ? decoded.args[4].roots.length : null,
        txBytes: decoded ? decoded.args[2].map(byteLength) : [],
        cc3Block: Number(evs[0]!.cc3Block),
        cc3Time,
        sourceBlocks: evs.map((e) => Number(e.sourceBlock)),
        latencies: evs.map((e) => cc3Time - (sourceTimes.get(e.sourceBlock) ?? cc3Time)),
      };
    });
    relayTxs.push(...records);
    log(`${relay.name}: ${events.length} roots in ${records.length} CC3 transactions`);
  }
  relayTxs.sort((a, b) => a.cc3Block - b.cc3Block);

  const direct = relayTxs.filter((t) => t.via === "direct" && t.members !== null);
  const sizes = [...new Set(direct.map((t) => t.members!))].sort((a, b) => a - b);
  const gasByBatchSize = sizes.map((n) => {
    const gas = direct.filter((t) => t.members === n).map((t) => t.gasUsed);
    return { n, observed: gas.length, min: Math.min(...gas), median: median(gas), max: Math.max(...gas) };
  });
  const liveFit = ols(direct.map((t) => [t.members!, t.gasUsed] as const));
  const liveModel = ols2(
    direct.filter((t) => t.continuityRoots !== null).map((t) => [t.members!, t.continuityRoots!, t.gasUsed] as const),
  );

  // ------------------------------------------------------------------ 2. batch gas probe
  const sepoliaRelay = o.relays.find((r) => r.name === "sepolia")!;
  const sepolia = createPublicClient({ transport: http(sepoliaRelay.sourceRpc, { timeout: 60_000, retryCount: 3 }) });
  const relayCode = await cc3.getCode({ address: sepoliaRelay.address });
  const tip = await cc3.readContract({
    address: CHAIN_INFO,
    abi: attestationTipAbi,
    functionName: "get_latest_attestation_height_and_hash",
    args: [1n],
  });
  const points: ProbePoint[] = [];
  const probeSamples: Array<{ txHash: string; batch: NormalizedBatch }> = [];
  let probeNote = "";
  try {
    // Recent blocks only: the proof builder's archiver does not keep continuity roots forever.
    const logs = await sepolia.getLogs({
      address: o.identityManagerSepolia,
      fromBlock: tip.height - 6_000n,
      toBlock: tip.height - 64n,
    });
    const updates = [
      ...new Map(
        logs
          .filter((l) => l.topics[0] === TREE_CHANGED_TOPIC)
          .map((l) => [l.transactionHash!, { hash: l.transactionHash!, block: Number(l.blockNumber) }] as const),
      ).values(),
    ];
    const window = densestWindow(updates);
    probeNote = `${window.length} consecutive Sepolia tree updates in blocks ${window[0]?.block}..${window.at(-1)?.block} (one batch proof spans at most 1,000 blocks), relayed onto a fresh copy of the live relay bytecode.`;
    for (let n = 1; n <= window.length; n += 1) {
      const members = window.slice(0, n);
      try {
        const batch = await proofFor(o.proverUrl, 1, members.map((m) => m.hash));
        if (n === 1) probeSamples.push({ txHash: members[0]!.hash, batch });
        const data = encodeFunctionData({ abi: attestedWorldIdAbi, functionName: "executeBatch", args: toExecuteBatchArgs(batch) });
        const r = await probe(cc3, RELAY_COPY_ADDRESS, data, relayCode ? [{ address: RELAY_COPY_ADDRESS, code: relayCode }] : []);
        points.push({
          n,
          ok: r.ok,
          executionGas: r.gas,
          txGas: r.gas + intrinsicGas(data),
          calldataBytes: byteLength(data),
          continuityRoots: batch.continuityProof.roots.length,
          error: r.ok ? undefined : decodeRefusal(r.ret)?.name,
          fromBlock: members[0]!.block,
          toBlock: members.at(-1)!.block,
        });
        log(`probe n=${n}: ${r.ok ? "ok" : `refused ${decodeRefusal(r.ret)?.name}`} execution ${r.gas}`);
      } catch (error) {
        log(`probe n=${n}: ${String(error).slice(0, 160)}`);
      }
    }
  } catch (error) {
    probeNote = `probe failed: ${String(error).slice(0, 200)}`;
  }
  const probeFit = ols(points.filter((p) => p.ok).map((p) => [p.n, p.txGas] as const));
  const probeModel = ols2(points.filter((p) => p.ok).map((p) => [p.n, p.continuityRoots, p.txGas] as const));

  // ------------------------------------------------------------------ 3. anchors
  const readGas = async (fn: "get_latest_attestation_height_and_hash" | "get_latest_checkpoint_height_and_hash") => {
    try {
      const r = await probe(cc3, CHAIN_INFO, encodeFunctionData({ abi: attestationTipAbi, functionName: fn, args: [1n] }));
      return r.ok ? r.gas : null;
    } catch {
      return null;
    }
  };
  const [attestationReadGas, checkpointReadGas] = await Promise.all([
    readGas("get_latest_attestation_height_and_hash"),
    readGas("get_latest_checkpoint_height_and_hash"),
  ]);
  const samples = [...o.proofs.map((p) => ({ txHash: p.txHash, batch: normalizeSingle(p) })), ...probeSamples];
  const verify = await pooled(samples, 3, async ({ txHash, batch }) => {
    const p = { txHash };
    const m = batch.members[0]!;
    let anchor: "attestation" | "checkpoint" | "unknown" = "unknown";
    try {
      const bounds = await cc3.readContract({
        address: CHAIN_INFO,
        abi: attestationBoundsAbi,
        functionName: "get_attestation_bounds",
        args: [BigInt(batch.chainKey), BigInt(m.blockHeight)],
      });
      // The continuity chain ends at `upper`: either the current attestation bound above the block,
      // or a checkpoint recorded at exactly that height.
      const upper = m.blockHeight + batch.continuityProof.roots.length - 1;
      if (bounds.isAttested && Number(bounds.childHeight) === upper) {
        anchor = bounds.childIsAttestation ? "attestation" : "checkpoint";
      } else {
        const checkpoint = await cc3.readContract({
          address: CHAIN_INFO,
          abi: checkpointForHeightAbi,
          functionName: "get_checkpoint_for_height",
          args: [BigInt(batch.chainKey), BigInt(upper)],
        });
        if (checkpoint.exists) anchor = "checkpoint";
      }
    } catch {
      /* unknown */
    }
    const data = encodeFunctionData({
      abi: nativeQueryVerifierAbi,
      functionName: "verify",
      args: [BigInt(batch.chainKey), BigInt(m.blockHeight), m.txBytes, m.merkleProof, batch.continuityProof],
    });
    try {
      const r = await probe(cc3, BLOCK_PROVER, data);
      return { txHash: p.txHash, chainKey: batch.chainKey, anchor, continuityRoots: batch.continuityProof.roots.length, gas: r.gas, ok: r.ok };
    } catch {
      return { txHash: p.txHash, chainKey: batch.chainKey, anchor, continuityRoots: batch.continuityProof.roots.length, gas: null, ok: false };
    }
  });

  // ------------------------------------------------------------------ 4. the cap
  const first = o.proofs.find((p) => Number(p.chainKey) === 1);
  let tenError: string | null = null;
  let elevenError: string | null = null;
  if (first) {
    const base = toExecuteBatchArgs(normalizeSingle(first));
    const copies = (n: number) =>
      encodeFunctionData({
        abi: attestedWorldIdAbi,
        functionName: "executeBatch",
        args: [base[0], Array(n).fill(base[1][0]), Array(n).fill(base[2][0]), Array(n).fill(base[3][0]), base[4]] as unknown as ExecuteBatchArgs,
      });
    for (const n of [10, 11]) {
      try {
        const r = await probe(cc3, sepoliaRelay.address, copies(n));
        const name = r.ok ? "accepted" : (decodeRefusal(r.ret)?.name ?? "revert");
        if (n === 10) tenError = name;
        else elevenError = name;
      } catch (error) {
        if (n === 10) tenError = String(error).slice(0, 120);
        else elevenError = String(error).slice(0, 120);
      }
    }
  }
  const fitForCap = probeFit ?? liveFit;
  const projectedGasAt10 = fitForCap ? Math.round(fitForCap.intercept + fitForCap.slope * 10) : null;
  const blockGasLimit = Number(latest.gasLimit);

  // ------------------------------------------------------------------ latency, proof sizes
  const series = relayTxs.flatMap((t) => t.latencies.map((seconds) => ({ at: t.cc3Time, relay: t.relay, seconds })));
  const times = relayTxs.map((t) => t.cc3Time);
  const allTxBytes = relayTxs.flatMap((t) => t.txBytes);
  const calldata = relayTxs.map((t) => t.calldataBytes);

  // ------------------------------------------------------------------ 5. precompile usage
  const scanBlocks = BigInt(o.precompileScanBlocks ?? 5_760);
  const fromBlock = head - scanBlocks + 1n;
  const txHashes = new Set<Hex>();
  let logCount = 0;
  for (let from = fromBlock; from <= head; from += 500n) {
    const to = from + 499n < head ? from + 499n : head;
    const logs = await cc3.getLogs({ address: BLOCK_PROVER, fromBlock: from, toBlock: to });
    logCount += logs.length;
    for (const l of logs) txHashes.add(l.transactionHash!);
  }
  const callersCount = new Map<string, number>();
  await pooled([...txHashes], 20, async (hash) => {
    const tx = await cc3.getTransaction({ hash }).catch(() => null);
    const to = (tx?.to ?? "contract-creation").toLowerCase();
    callersCount.set(to, (callersCount.get(to) ?? 0) + 1);
  });
  const callers = [...callersCount.entries()]
    .map(([to, txs]) => ({ to, txs, humanline: humanline.has(to) }))
    .sort((a, b) => b.txs - a.txs);
  const humanlineTxs = callers.filter((c) => c.humanline).reduce((s, c) => s + c.txs, 0);
  const [fromTime, toTime] = await Promise.all([cc3.getBlock({ blockNumber: fromBlock }), Promise.resolve(latest)]);
  log(`0x0FD2: ${logCount} logs in ${txHashes.size} txs over ${scanBlocks} blocks, ${callers.length} distinct callers`);

  return {
    generatedAt: new Date().toISOString(),
    cc3: { chainId: 102031, head: Number(head), blockGasLimit },
    relayTxs,
    gasByBatchSize,
    liveFit,
    liveModel,
    probe: { points, fit: probeFit, model: probeModel, note: probeNote },
    anchors: {
      attestationReadGas,
      checkpointReadGas,
      verify,
      verifyFit: ols(verify.filter((v) => v.ok && v.gas !== null).map((v) => [v.continuityRoots, v.gas!] as const)),
    },
    cap: {
      tenError,
      elevenError,
      projectedGasAt10,
      headroomAt10: projectedGasAt10 ? Math.floor(blockGasLimit / projectedGasAt10) : null,
    },
    latency: {
      summary: summarize(series.map((s) => s.seconds)),
      spanHours: times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600 : 0,
      byRelay: Object.fromEntries(o.relays.map((r) => [r.name, summarize(series.filter((s) => s.relay === r.name).map((s) => s.seconds))])),
      series,
    },
    proofSizes: {
      calldata: summarize(calldata),
      txBytes: summarize(allTxBytes),
      continuityRoots: summarize(relayTxs.flatMap((t) => (t.continuityRoots === null ? [] : [t.continuityRoots]))),
      histogram: histogram(calldata, 2_000),
    },
    precompile: {
      fromBlock: Number(fromBlock),
      toBlock: Number(head),
      hours: (Number(toTime.timestamp) - Number(fromTime.timestamp)) / 3600,
      logs: logCount,
      txs: txHashes.size,
      callers,
      humanlineTxs,
      humanlineShare: txHashes.size === 0 ? 0 : humanlineTxs / txHashes.size,
    },
  };
}

const HEIGHT_AND_HASH = [
  {
    name: "result",
    type: "tuple",
    components: [
      { name: "height", type: "uint64" },
      { name: "hash", type: "bytes32" },
      { name: "isAttestation", type: "bool" },
      { name: "exists", type: "bool" },
    ],
  },
] as const;

const attestationTipAbi = [
  {
    type: "function",
    name: "get_latest_attestation_height_and_hash",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: HEIGHT_AND_HASH,
  },
  {
    type: "function",
    name: "get_latest_checkpoint_height_and_hash",
    stateMutability: "view",
    inputs: [{ name: "chainKey", type: "uint64" }],
    outputs: HEIGHT_AND_HASH,
  },
] as const;

const checkpointForHeightAbi = [
  {
    type: "function",
    name: "get_checkpoint_for_height",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "height", type: "uint64" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "hash", type: "bytes32" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

const attestationBoundsAbi = [
  {
    type: "function",
    name: "get_attestation_bounds",
    stateMutability: "view",
    inputs: [
      { name: "chainKey", type: "uint64" },
      { name: "targetHeight", type: "uint64" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "parentHeight", type: "uint64" },
          { name: "parentHash", type: "bytes32" },
          { name: "parentIsAttestation", type: "bool" },
          { name: "childHeight", type: "uint64" },
          { name: "childHash", type: "bytes32" },
          { name: "childIsAttestation", type: "bool" },
          { name: "isAttested", type: "bool" },
        ],
      },
    ],
  },
] as const;
