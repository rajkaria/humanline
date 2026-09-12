/**
 * The relay evidence log, snapshotted from `evidence/relay-log.jsonl`.
 *
 * The worker appends one JSON object per relayed root. The web app uses it for
 * two things:
 *
 *  1. `/judge` renders it as the reproducibility record.
 *  2. `/relay` joins it to on-chain `RootRelayed` events to recover the *source*
 *     transaction hash, which the event itself does not carry (it carries the
 *     block height and the tx index that Attestcoin's `calculateTxIndex`
 *     derived). With the hash we link straight to Etherscan; without it we fall
 *     back to linking the source block.
 *
 * Field names are read defensively. The worker writes
 * `{source, txHash, sourceBlock, txIndex, preRoot, postRoot, kind, humansAdded,
 * cc3TxHash, gasUsed, attestationLagSec, at}`; the aliases below also accept the
 * obvious alternative spellings so a change on that side degrades to a missing
 * column rather than an empty table.
 */

import rawEvidence from "./generated/evidence.json";

export type EvidenceEntry = {
  chainKey?: number;
  sourceBlock?: bigint;
  sourceTxIndex?: bigint;
  sourceTxHash?: `0x${string}`;
  creditcoinTxHash?: `0x${string}`;
  preRoot?: bigint;
  postRoot?: bigint;
  kind?: number;
  humansAdded?: number;
  queryId?: `0x${string}`;
  /** Unix seconds. */
  timestamp?: number;
  /** Gas the relay transaction burned on Creditcoin. */
  gasUsed?: bigint;
  /** Seconds between the source block and the root landing on Creditcoin. */
  attestationLagSec?: number;
  /** Everything as written, for the raw copy on `/judge`. */
  raw: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function pickBigInt(source: Record<string, unknown>, keys: string[]): bigint | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
    if (typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value.trim())) {
      try {
        return BigInt(value.trim());
      } catch {
        // fall through to the next candidate key
      }
    }
  }
  return undefined;
}

function pickHash(source: Record<string, unknown>, keys: string[]): `0x${string}` | undefined {
  const value = pickString(source, keys);
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as `0x${string}`) : undefined;
}

/** The worker labels rows `"mainnet"` / `"sepolia"`; Attestcoin keys them 3 / 1. */
function pickChainKey(entry: Record<string, unknown>): number | undefined {
  const explicit = pickBigInt(entry, ["chainKey", "chain_key", "sourceChainKey"]);
  if (explicit !== undefined) return Number(explicit);

  const label = pickString(entry, ["source", "sourceChain", "chain", "network"])?.toLowerCase();
  if (!label) return undefined;
  if (label.includes("main") || label === "ethereum" || label === "l1") return 3;
  if (label.includes("sepolia") || label.includes("staging")) return 1;
  return undefined;
}

/** `at` is an ISO-8601 string; `timestamp`/`ts` may be unix seconds or millis. */
function pickTimestamp(entry: Record<string, unknown>): number | undefined {
  const iso = pickString(entry, ["at", "relayedAt", "time", "timestamp"]);
  if (iso && Number.isNaN(Number(iso))) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  const numeric = pickBigInt(entry, ["timestamp", "ts", "relayedAt", "time"]);
  if (numeric === undefined) return undefined;
  const value = Number(numeric);
  // Anything past the year 33658 in seconds is really milliseconds.
  return value > 1e12 ? Math.floor(value / 1000) : value;
}

function normalise(entry: unknown): EvidenceEntry | null {
  if (!isRecord(entry)) return null;
  const humansAdded = pickBigInt(entry, ["humansAdded", "humans_added", "identitiesAdded"]);
  const kind = pickBigInt(entry, ["kind"]);
  return {
    chainKey: pickChainKey(entry),
    sourceBlock: pickBigInt(entry, [
      "sourceBlock",
      "blockHeight",
      "headerNumber",
      "height",
      "block",
    ]),
    sourceTxIndex: pickBigInt(entry, ["sourceTxIndex", "txIndex", "transactionIndex"]),
    sourceTxHash: pickHash(entry, ["sourceTxHash", "txHash", "ethereumTxHash", "sourceTx"]),
    creditcoinTxHash: pickHash(entry, [
      "cc3TxHash",
      "creditcoinTxHash",
      "relayTxHash",
      "ccTxHash",
      "destinationTxHash",
    ]),
    preRoot: pickBigInt(entry, ["preRoot", "pre_root"]),
    postRoot: pickBigInt(entry, ["postRoot", "post_root", "root"]),
    kind: kind === undefined ? undefined : Number(kind),
    humansAdded: humansAdded === undefined ? undefined : Number(humansAdded),
    queryId: pickHash(entry, ["queryId", "query_id"]),
    timestamp: pickTimestamp(entry),
    gasUsed: pickBigInt(entry, ["gasUsed", "gas_used"]),
    attestationLagSec: Number(
      pickBigInt(entry, ["attestationLagSec", "attestation_lag_sec", "lagSeconds"]) ?? 0n,
    ) || undefined,
    raw: entry,
  };
}

export const EVIDENCE: EvidenceEntry[] = Array.isArray(rawEvidence)
  ? (rawEvidence as unknown[]).map(normalise).filter((e): e is EvidenceEntry => e !== null)
  : [];

export const hasEvidence = EVIDENCE.length > 0;

const BY_SOURCE_TX = new Map<string, EvidenceEntry>();
for (const entry of EVIDENCE) {
  if (
    entry.chainKey !== undefined &&
    entry.sourceBlock !== undefined &&
    entry.sourceTxIndex !== undefined
  ) {
    BY_SOURCE_TX.set(`${entry.chainKey}:${entry.sourceBlock}:${entry.sourceTxIndex}`, entry);
  }
}

const BY_POST_ROOT = new Map<string, EvidenceEntry>();
for (const entry of EVIDENCE) {
  if (entry.postRoot !== undefined) BY_POST_ROOT.set(entry.postRoot.toString(), entry);
}

/**
 * Find the evidence row for one relayed root.
 *
 * Matched on (chainKey, sourceBlock, txIndex) first, then on the post-root — the
 * root is globally unique, so it is a safe second key if the worker ever records
 * the block or index differently from how Attestcoin derived it.
 */
export function evidenceFor(
  chainKey: number,
  sourceBlock: bigint,
  sourceTxIndex: bigint,
  postRoot?: bigint,
): EvidenceEntry | undefined {
  return (
    BY_SOURCE_TX.get(`${chainKey}:${sourceBlock}:${sourceTxIndex}`) ??
    (postRoot === undefined ? undefined : BY_POST_ROOT.get(postRoot.toString()))
  );
}
