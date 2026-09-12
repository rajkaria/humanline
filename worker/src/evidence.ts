// Append-only relay evidence. One JSON object per line, stable key order, so the file
// diffs cleanly when the GitHub Actions cron commits it back and the /relay page can
// stream it without a schema negotiation.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { evidencePath } from "./config";

export interface EvidenceInput {
  source: string;
  txHash: string;
  sourceBlock: number;
  txIndex: number;
  preRoot: bigint | string;
  postRoot: bigint | string;
  kind: number;
  humansAdded: number;
  cc3TxHash: string | null;
  gasUsed: bigint | number | string | null;
  attestationLagSec: number | null;
  at?: string;
  /** The AttestedWorldID instance that received this root. */
  contract?: string | null;
}

export interface EvidenceLine {
  source: string;
  txHash: string;
  sourceBlock: number;
  txIndex: number;
  preRoot: string;
  postRoot: string;
  kind: number;
  humansAdded: number;
  cc3TxHash: string | null;
  gasUsed: string | null;
  attestationLagSec: number | null;
  at: string;
  /**
   * The AttestedWorldID instance that received this root.
   *
   * Last, and nullable, so the rows written before the field existed still parse and
   * the documented key order is unchanged. Without it a reader cannot tell which
   * deployment a row belongs to after a redeploy — which is exactly the question a
   * judge asks when the addresses in the docs do not match an old row.
   */
  contract: string | null;
}

function hex32(v: bigint | string): string {
  const n = typeof v === "bigint" ? v : BigInt(v);
  return `0x${n.toString(16).padStart(64, "0")}`;
}

/** Pure: builds the evidence record with the exact field set and order from the brief. */
export function formatEvidenceLine(input: EvidenceInput): EvidenceLine {
  return {
    source: input.source,
    txHash: input.txHash.toLowerCase(),
    sourceBlock: input.sourceBlock,
    txIndex: input.txIndex,
    preRoot: hex32(input.preRoot),
    postRoot: hex32(input.postRoot),
    kind: input.kind,
    humansAdded: input.humansAdded,
    cc3TxHash: input.cc3TxHash ? input.cc3TxHash.toLowerCase() : null,
    gasUsed: input.gasUsed === null || input.gasUsed === undefined ? null : String(input.gasUsed),
    attestationLagSec: input.attestationLagSec ?? null,
    at: input.at ?? new Date().toISOString(),
    contract: input.contract ? input.contract.toLowerCase() : null,
  };
}

export function serializeEvidenceLine(input: EvidenceInput): string {
  return `${JSON.stringify(formatEvidenceLine(input))}\n`;
}

export function appendEvidence(input: EvidenceInput, path = evidencePath()): EvidenceLine {
  const line = formatEvidenceLine(input);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
  return line;
}

export function readEvidence(path = evidencePath()): EvidenceLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvidenceLine);
}
