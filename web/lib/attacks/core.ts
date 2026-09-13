/**
 * Twelve attacks against the live Creditcoin contracts, each fired as a read-only `eth_call`.
 *
 * Nothing here signs or spends: every attack is the exact calldata an attacker would send, simulated
 * against CC3 testnet state, and the result is the custom error the contract (or the 0x0FD2
 * BlockProver precompile) refuses it with. `bun run worker/src/cli.ts attack` runs the set and records
 * it in `evidence/attacks.json`; `/judge` runs the same set on page load with no wallet.
 *
 * Inputs are real: genuine Sepolia transactions with genuine Attestcoin proofs (see `discover.ts`).
 * An attack that needs a state the live deployment is not in (fewer bonded attestors than the floor)
 * runs the *live bytecode* at a scratch address through an `eth_call` state override, with the one
 * immutable changed, so the refusal still comes from the deployed code and the real precompiles.
 *
 * Pure except `runAttacks`, which takes the RPC URL and builds its own client.
 */

import {
  BaseError,
  createPublicClient,
  decodeAbiParameters,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { attestedWorldIdAbi, humanRegistryAbi, nativeQueryVerifierAbi } from "../abi";
import { normalizeSingle, toExecuteBatchArgs, type ExecuteBatchArgs, type SingleProofJson } from "../relay/proof";

export const TREE_CHANGED_TOPIC: Hex = "0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04";

/** Where the attacks aim and what they carry. Written by `discover.ts`, committed as evidence. */
export type AttackInputs = {
  generatedAt: string;
  /** `AttestedWorldID` mirroring Sepolia (chainKey 1) and Ethereum mainnet (chainKey 3). */
  sepoliaRelay: Address;
  mainnetRelay: Address;
  registry: Address;
  /** A World ID tree update the Sepolia relay has already adopted. */
  relayed: SingleProofJson;
  /** A genuine, attested Sepolia transaction that is not a World ID tree update (a USDC transfer). */
  foreign: SingleProofJson;
  /** A genuine, attested Sepolia transaction whose receipt status is 0. */
  reverted?: SingleProofJson;
  /** A genuine Sepolia tree update from before the relay's history begins. */
  stale?: SingleProofJson;
  /** A wallet already registered as a human, and its nullifier. */
  registered?: { wallet: Address; nullifierHash: string };
};

/** One simulated transaction. `stateOverride` replaces code at an address for this call only. */
export type AttackCall = {
  to: Address;
  data: Hex;
  from?: Address;
  stateOverride?: Array<{ address: Address; code: Hex }>;
};

export type AttackPlan = {
  id: string;
  title: string;
  /** What the attacker is trying to get away with. */
  threat: string;
  /** Error names that count as the right refusal. */
  expect: readonly string[];
  /** Absent when the inputs it needs could not be discovered. */
  call?: AttackCall;
  /** Why `call` is absent, or a note on how the attack is staged. */
  note?: string;
};

export type AttackResult = {
  id: string;
  title: string;
  threat: string;
  expect: readonly string[];
  /** `refused` = reverted with an expected error; `wrong-error` = reverted, but not as expected. */
  outcome: "refused" | "wrong-error" | "accepted" | "skipped" | "rpc-error";
  error?: string;
  args?: string[];
  revertData?: Hex;
  note?: string;
  target?: Address;
  ms?: number;
};

/** A scratch address for state-override copies: nothing is deployed there on CC3. */
export const SCRATCH_ADDRESS: Address = "0x00000000000000000000000000000000dec0de01";
/** An emitter that is not the identity manager, for the decoy log. */
export const DECOY_EMITTER: Address = "0x000000000000000000000000000000000000dec0";
/** How the live 0x0FD2 precompile refuses a proof, verbatim (observed on CC3 testnet 2026-09-13). */
export const MERKLE_REFUSAL = "Error: Merkle proof validation failed";
export const CONTINUITY_REFUSAL = "Error: Continuity proof does not match attestation or checkpoint";

/** The attestor floor the scratch copy demands, far above any real bonded set. */
export const IMPOSSIBLE_FLOOR = 1_000n;

const refusalAbi = [...attestedWorldIdAbi, ...humanRegistryAbi, ...nativeQueryVerifierAbi].filter(
  (item) => item.type === "error",
) as Abi;

const executeBatchData = (args: ExecuteBatchArgs): Hex =>
  encodeFunctionData({ abi: attestedWorldIdAbi, functionName: "executeBatch", args });

function argsOf(proof: SingleProofJson): ExecuteBatchArgs {
  return toExecuteBatchArgs(normalizeSingle(proof));
}

/** `n` copies of one proof's member under one continuity proof. */
export function repeated(proof: SingleProofJson, n: number): ExecuteBatchArgs {
  const [chainKey, heights, txs, merkles, continuity] = argsOf(proof);
  const h = heights[0] ?? 0n;
  const tx = txs[0] ?? "0x";
  const m = merkles[0];
  if (!m) throw new Error("proof has no member");
  return [chainKey, Array(n).fill(h), Array(n).fill(tx), Array(n).fill(m), continuity] as const;
}

/** Flip the last byte of the first Merkle sibling: a forged inclusion path. */
export function forgeSibling(args: ExecuteBatchArgs): ExecuteBatchArgs {
  const [chainKey, heights, txs, merkles, continuity] = args;
  const first = merkles[0];
  if (!first || first.siblings.length === 0) throw new Error("no sibling to forge");
  const [s0, ...rest] = first.siblings;
  const hash = s0!.hash;
  const last = (parseInt(hash.slice(-2), 16) ^ 0xff).toString(16).padStart(2, "0");
  const forged = { root: first.root, siblings: [{ hash: `${hash.slice(0, -2)}${last}` as Hex, isLeft: s0!.isLeft }, ...rest] };
  return [chainKey, heights, txs, [forged, ...merkles.slice(1)], continuity] as const;
}

const LOG_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "address_", type: "address" },
    { name: "topics", type: "bytes32[]" },
    { name: "data", type: "bytes" },
  ],
} as const;

/**
 * Append a `TreeChanged` log from a decoy emitter to an EvmV1-encoded transaction's receipt.
 * The bytes still decode, and the contract would skip the decoy; the proof no longer matches.
 */
export function injectDecoyLog(txBytes: Hex, postRoot: Hex = `0x${"ab".repeat(32)}`): Hex {
  const [txType, chunks] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes[]" }], txBytes);
  const receiptIndex = txType <= 2 ? 2 : 3;
  const receipt = chunks[receiptIndex];
  if (!receipt) throw new Error("no receipt chunk");
  const [status, gasUsed, logs, bloom] = decodeAbiParameters(
    [{ type: "uint8" }, { type: "uint64" }, LOG_TUPLE, { type: "bytes" }],
    receipt,
  );
  const decoy = {
    address_: DECOY_EMITTER,
    topics: [TREE_CHANGED_TOPIC, `0x${"00".repeat(32)}` as Hex, `0x${"00".repeat(32)}` as Hex, postRoot],
    data: "0x" as Hex,
  };
  const nextReceipt = encodeAbiParameters(
    [{ type: "uint8" }, { type: "uint64" }, LOG_TUPLE, { type: "bytes" }],
    [status, gasUsed, [...logs, decoy], bloom],
  );
  const nextChunks = chunks.map((c, i) => (i === receiptIndex ? nextReceipt : c));
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes[]" }], [txType, nextChunks]);
}

/** Number of logs in an EvmV1-encoded transaction's receipt. */
export function receiptLogCount(txBytes: Hex): number {
  const [txType, chunks] = decodeAbiParameters([{ type: "uint8" }, { type: "bytes[]" }], txBytes);
  const receipt = chunks[txType <= 2 ? 2 : 3];
  if (!receipt) throw new Error("no receipt chunk");
  const [, , logs] = decodeAbiParameters([{ type: "uint8" }, { type: "uint64" }, LOG_TUPLE, { type: "bytes" }], receipt);
  return logs.length;
}

/**
 * Replace every `PUSH32 <from>` in runtime bytecode with `PUSH32 <to>`. Solidity inlines each
 * immutable as a PUSH32 of its value at every read, so this changes one immutable when its value is
 * unique among the contract's PUSH32 constants (the caller checks `replaced`, and the attack reads the
 * getter back through the override before relying on it).
 */
export function patchPush32(code: Hex, from: bigint, to: bigint): { code: Hex; replaced: number } {
  const word = (v: bigint) => `7f${v.toString(16).padStart(64, "0")}`;
  const hex = code.slice(2).toLowerCase();
  const needle = word(from);
  let out = "";
  let replaced = 0;
  let i = 0;
  while (i < hex.length) {
    const at = hex.indexOf(needle, i);
    if (at < 0) {
      out += hex.slice(i);
      break;
    }
    if (at % 2 !== 0) {
      out += hex.slice(i, at + 1);
      i = at + 1;
      continue;
    }
    out += hex.slice(i, at) + word(to);
    replaced += 1;
    i = at + needle.length;
  }
  return { code: `0x${out}`, replaced };
}

/** The twelve attacks, as calls. `patchedCode` is the live relay code with the attestor floor raised. */
export function planAttacks(
  inputs: AttackInputs,
  ctx: { attestedTip: bigint; patchedCode?: Hex },
): AttackPlan[] {
  const { relayed, foreign } = inputs;
  const relay = inputs.sepoliaRelay;
  const plans: AttackPlan[] = [];
  const add = (p: AttackPlan) => plans.push(p);

  add({
    id: "forged-proof",
    title: "Forged Merkle proof",
    threat: "Claim a World ID root with an inclusion path that was never in the source block.",
    expect: [MERKLE_REFUSAL, "BatchProofRejected"],
    note: "0x0FD2 refuses inside the relay's own call, so the contract's BatchProofRejected is never reached.",
    call: { to: relay, data: executeBatchData(forgeSibling(argsOf(relayed))) },
  });

  add({
    id: "wrong-emitter",
    title: "Wrong contract called",
    threat: "Relay a genuine, attested Sepolia transaction that did not call the World ID identity manager.",
    expect: ["NotIdentityManager"],
    call: { to: relay, data: executeBatchData(argsOf(foreign)) },
    note: `Sepolia tx ${foreign.txHash}: a USDC transfer, proved by the real 0x0FD2.`,
  });

  add({
    id: "reverted-receipt",
    title: "Reverted source transaction",
    threat: "Relay a genuine transaction that failed on Sepolia, as if its state change had happened.",
    expect: ["SourceTxReverted"],
    call: inputs.reverted ? { to: relay, data: executeBatchData(argsOf(inputs.reverted)) } : undefined,
    note: inputs.reverted
      ? `Sepolia tx ${inputs.reverted.txHash}: receipt status 0, proved by the real 0x0FD2.`
      : "No reverted Sepolia transaction was discovered in the attested range.",
  });

  add({
    id: "replay",
    title: "Replay an adopted root",
    threat: "Submit a proof the relay has already consumed, to double-count a root or its reward.",
    expect: ["QueryAlreadyProcessed"],
    call: { to: relay, data: executeBatchData(argsOf(relayed)) },
    note: `Sepolia tx ${relayed.txHash}, already relayed on CC3.`,
  });

  const r = argsOf(relayed);
  const f = argsOf(foreign);
  const [lo, hi] = (f[1][0] ?? 0n) < (r[1][0] ?? 0n) ? [f, r] : [r, f];
  add({
    id: "out-of-order",
    title: "Roots out of order",
    threat: "Batch a later source block before an earlier one to reorder the root chain.",
    expect: ["BatchOutOfOrder"],
    call: {
      to: relay,
      data: executeBatchData([
        r[0],
        [hi[1][0] ?? 0n, lo[1][0] ?? 0n],
        [hi[2][0] ?? "0x", lo[2][0] ?? "0x"],
        [hi[3][0]!, lo[3][0]!],
        r[4],
      ] as const),
    },
  });

  const unattested = BigInt(ctx.attestedTip) + 10_000n;
  add({
    id: "unattested-height",
    title: "Unattested block height",
    threat: "Claim the transaction sits in a block Creditcoin's attestors have not signed yet.",
    expect: [CONTINUITY_REFUSAL, "BatchProofRejected"],
    call: { to: relay, data: executeBatchData([r[0], [unattested], r[2], r[3], r[4]] as const) },
    note: `Height ${unattested}, 10,000 blocks past the attested tip ${ctx.attestedTip}.`,
  });

  add({
    id: "below-attestor-floor",
    title: "Below the attestor floor",
    threat: "Adopt a root while fewer bonded attestors back the source chain than the relay demands.",
    expect: ["ThinQuorum"],
    call: ctx.patchedCode
      ? {
          to: SCRATCH_ADDRESS,
          data: executeBatchData(argsOf(relayed)),
          stateOverride: [{ address: SCRATCH_ADDRESS, code: ctx.patchedCode }],
        }
      : undefined,
    note: ctx.patchedCode
      ? `The live Sepolia relay bytecode, run at a scratch address with MIN_ATTESTORS raised from 3 to ${IMPOSSIBLE_FLOOR}; attestor count read from the real 0x0FD4.`
      : "Could not read the live relay bytecode.",
  });

  add({
    id: "wrong-chain-key",
    title: "Wrong source chain",
    threat: "Feed a genuine Sepolia (staging) root into the Ethereum mainnet (Orb) relay.",
    expect: ["WrongSourceChain"],
    call: { to: inputs.mainnetRelay, data: executeBatchData(argsOf(relayed)) },
  });

  const decoyed = normalizeSingle(relayed);
  const m0 = decoyed.members[0]!;
  add({
    id: "decoy-tree-changed",
    title: "Decoy TreeChanged log",
    threat: "Append a fake TreeChanged event from another emitter to a real receipt.",
    expect: [MERKLE_REFUSAL, "BatchProofRejected"],
    call: {
      to: relay,
      data: executeBatchData(
        toExecuteBatchArgs({ ...decoyed, members: [{ ...m0, txBytes: injectDecoyLog(m0.txBytes) }] }),
      ),
    },
    note: "The receipt is part of the proved leaf, so any added log breaks inclusion.",
  });

  add({
    id: "oversize-batch",
    title: "Oversize batch (11)",
    threat: "Push eleven transactions through one call to exceed the gas the relay budgets for.",
    expect: ["BatchTooLarge"],
    call: { to: relay, data: executeBatchData(repeated(relayed, 11)) },
  });

  add({
    id: "stale-root",
    title: "Root from before the history",
    threat: "Introduce a genuine but old World ID root that does not chain onto anything the relay holds.",
    expect: ["UnknownPreRoot"],
    call: inputs.stale ? { to: relay, data: executeBatchData(argsOf(inputs.stale)) } : undefined,
    note: inputs.stale
      ? `Sepolia tx ${inputs.stale.txHash}, a tree update from before this relay's first root.`
      : "No pre-history tree update was discovered.",
  });

  add({
    id: "double-registration",
    title: "One human, a second registration",
    threat: "Register the same World ID nullifier again from the wallet already bound to it.",
    expect: ["SameWallet"],
    call: inputs.registered
      ? {
          to: inputs.registry,
          from: inputs.registered.wallet,
          data: encodeFunctionData({
            abi: humanRegistryAbi,
            functionName: "register",
            args: [0n, BigInt(inputs.registered.nullifierHash), [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]],
          }),
        }
      : undefined,
    note: inputs.registered
      ? `Wallet ${inputs.registered.wallet}, registered on CC3.`
      : "No registered wallet was discovered.",
  });

  return plans;
}

/** Revert data from a viem error chain, if any. */
export function revertDataOf(error: unknown): Hex | undefined {
  let e: unknown = error;
  for (let depth = 0; e && depth < 10; depth += 1) {
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x")) return data as Hex;
    if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") {
      return (data as { data: Hex }).data;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Custom error name and arguments for revert data, against every Humanline error. */
export function decodeRefusal(data: Hex | undefined): { name: string; args: string[] } | undefined {
  if (!data || data === "0x") return undefined;
  try {
    const decoded = decodeErrorResult({ abi: refusalAbi, data });
    const args = (decoded.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
    // The precompiles refuse with a plain `Error(string)`; the message is the name worth showing.
    if (decoded.errorName === "Error") return { name: `Error: ${args[0] ?? ""}`, args: [] };
    return { name: decoded.errorName, args };
  } catch {
    if (data.length >= 10) return { name: `unknown(${data.slice(0, 10)})`, args: [] };
    return undefined;
  }
}

export function classify(plan: AttackPlan, decoded: { name: string } | undefined): AttackResult["outcome"] {
  if (!decoded) return "wrong-error";
  return plan.expect.includes(decoded.name) ? "refused" : "wrong-error";
}

const errorMessage = (e: unknown) => (e instanceof BaseError ? e.shortMessage : String(e)).slice(0, 240);

/** Fire every attack at the live chain. Never throws; each attack reports its own outcome. */
export async function runAttacks(
  inputs: AttackInputs,
  { rpcUrl, timeoutMs = 30_000 }: { rpcUrl: string; timeoutMs?: number },
): Promise<{ attestedTip: string; attestors: number | null; results: AttackResult[] }> {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: timeoutMs, retryCount: 1 }) });

  const [attestation, attestors, liveCode] = await Promise.all([
    client
      .readContract({
        address: "0x0000000000000000000000000000000000000fD3",
        abi: [
          {
            type: "function",
            name: "get_latest_attestation_height_and_hash",
            stateMutability: "view",
            inputs: [{ name: "chainKey", type: "uint64" }],
            outputs: [
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
            ],
          },
        ] as const,
        functionName: "get_latest_attestation_height_and_hash",
        args: [1n],
      })
      .then((r) => r.height)
      .catch(() => 0n),
    client
      .readContract({
        address: "0x0000000000000000000000000000000000000fd4",
        abi: [
          {
            type: "function",
            name: "getAttestorsCount",
            stateMutability: "view",
            inputs: [{ name: "chainKey", type: "uint64" }],
            outputs: [{ type: "uint32" }],
          },
        ] as const,
        functionName: "getAttestorsCount",
        args: [1n],
      })
      .then(Number)
      .catch(() => null),
    client.getCode({ address: inputs.sepoliaRelay }).catch(() => undefined),
  ]);

  let patchedCode: Hex | undefined;
  if (liveCode && liveCode !== "0x") {
    const patched = patchPush32(liveCode, 3n, IMPOSSIBLE_FLOOR);
    if (patched.replaced > 0) {
      const floor = await client
        .call({
          to: SCRATCH_ADDRESS,
          data: encodeFunctionData({ abi: attestedWorldIdAbi, functionName: "MIN_ATTESTORS" }),
          stateOverride: [{ address: SCRATCH_ADDRESS, code: patched.code }],
        })
        .then((r) => (r.data ? BigInt(r.data) : 0n))
        .catch(() => 0n);
      if (floor === IMPOSSIBLE_FLOOR) patchedCode = patched.code;
    }
  }

  const plans = planAttacks(inputs, { attestedTip: attestation, patchedCode });
  const results = await Promise.all(
    plans.map(async (plan): Promise<AttackResult> => {
      const base = { id: plan.id, title: plan.title, threat: plan.threat, expect: plan.expect, note: plan.note };
      if (!plan.call) return { ...base, outcome: "skipped" };
      const t0 = Date.now();
      try {
        await client.call({
          to: plan.call.to,
          data: plan.call.data,
          account: plan.call.from,
          stateOverride: plan.call.stateOverride,
        });
        return { ...base, outcome: "accepted", target: plan.call.to, ms: Date.now() - t0 };
      } catch (error) {
        const data = revertDataOf(error);
        const decoded = decodeRefusal(data);
        if (!data && !/revert/i.test(errorMessage(error))) {
          return { ...base, outcome: "rpc-error", error: errorMessage(error), target: plan.call.to, ms: Date.now() - t0 };
        }
        return {
          ...base,
          outcome: classify(plan, decoded),
          error: decoded?.name ?? (data && data !== "0x" ? data.slice(0, 10) : "revert without data"),
          args: decoded?.args,
          revertData: data,
          target: plan.call.to,
          ms: Date.now() - t0,
        };
      }
    }),
  );

  return { attestedTip: attestation.toString(), attestors, results };
}
