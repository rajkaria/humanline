// ABI access. Prefers the compiled artifact at contracts/abi/<Name>.json when the contracts
// task has landed; otherwise falls back to the minimal hand-written fragments below, taken
// verbatim from docs/PLAN.md "Interfaces".
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Interface } from "ethers";
import { REPO_ROOT } from "./config";

/**
 * Minimal AttestedWorldID surface the worker needs:
 * `execute` / `executeBatch` writes, the reads used by `check`/`status`, and `RootRelayed`.
 * Custom errors are included so ethers can decode revert data.
 */
export const ATTESTED_WORLD_ID_FRAGMENTS = [
  // --- writes (ASCBase.execute + batch variant) ---
  "function execute(uint8 action, uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, tuple(bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots) returns (bool success)",
  "function executeBatch(uint64 chainKey, uint64[] blockHeights, bytes[] encodedTransactions, tuple(bytes32 root, tuple(bytes32 hash, bool isLeft)[] siblings)[] merkleProofs, tuple(bytes32 lowerEndpointDigest, bytes32[] roots) sharedContinuityProof)",
  // --- reads ---
  "function latestRoot() view returns (uint256)",
  "function rootCount() view returns (uint256)",
  "function rootHistory(uint256 root) view returns (uint128 receivedAt)",
  "function humansAddedTotal() view returns (uint256)",
  "function isValidRoot(uint256 root) view returns (bool)",
  "function processedQueries(bytes32 queryId) view returns (bool)",
  "function SOURCE_CHAIN_KEY() view returns (uint64)",
  "function IDENTITY_MANAGER() view returns (address)",
  "function FINALITY_DEPTH() view returns (uint64)",
  "function MIN_ATTESTORS() view returns (uint32)",
  "function VERIFIER() view returns (address)",
  // --- events ---
  "event RootRelayed(bytes32 indexed queryId, uint64 indexed sourceBlock, uint256 indexed postRoot, uint256 preRoot, uint8 kind, uint32 humansAdded, uint256 sourceTxIndex, address relayer)",
  // --- errors (so revert reasons decode without the artifact) ---
  // AttestedWorldID's batch entrypoint reverts this instead of ASCBase's require string.
  "error QueryAlreadyProcessed(bytes32 queryId)",
  "error WrongSourceChain(uint64 got, uint64 want)",
  "error SourceTxReverted()",
  "error NotIdentityManager(address to)",
  "error NoTreeChange()",
  "error AmbiguousTreeChange(uint256 count)",
  "error CalldataLogMismatch()",
  "error UnknownPreRoot(uint256 preRoot)",
  "error NotFinal(uint64 attestedTip, uint64 sourceBlock)",
  "error ThinQuorum(uint32 have, uint32 want)",
  "error CannotOverwriteRoot()",
] as const;

/** Function/event/error names the worker must be able to encode or decode. */
const REQUIRED = [
  "execute",
  "executeBatch",
  "latestRoot",
  "rootCount",
  "processedQueries",
  "RootRelayed",
];

export function abiArtifactPath(name: string): string {
  return resolve(REPO_ROOT, "contracts", "abi", `${name}.json`);
}

function readArtifactAbi(name: string): unknown[] | undefined {
  const path = abiArtifactPath(name);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.abi)) return parsed.abi; // forge build artifact
    return undefined;
  } catch {
    return undefined;
  }
}

/** True when `iface` can resolve every name in REQUIRED. */
export function missingFragments(iface: Interface): string[] {
  const missing: string[] = [];
  for (const name of REQUIRED) {
    let found = false;
    iface.forEachFunction((f) => {
      if (f.name === name) found = true;
    });
    if (!found) {
      iface.forEachEvent((e) => {
        if (e.name === name) found = true;
      });
    }
    if (!found) missing.push(name);
  }
  return missing;
}

export interface LoadedAbi {
  iface: Interface;
  /** "artifact" | "artifact+fragments" | "fragments" */
  origin: string;
  path?: string;
}

let cached: LoadedAbi | undefined;

/**
 * Loads the AttestedWorldID ABI. When the artifact exists but is missing something the
 * worker needs, the hand-written fragments are appended rather than replacing it.
 */
export function loadAttestedWorldIdAbi(force = false): LoadedAbi {
  if (cached && !force) return cached;
  const artifact = readArtifactAbi("AttestedWorldID");
  if (artifact) {
    const iface = new Interface(artifact as never);
    const missing = missingFragments(iface);
    if (missing.length === 0) {
      cached = { iface, origin: "artifact", path: abiArtifactPath("AttestedWorldID") };
      return cached;
    }
    const merged = new Interface([
      ...(artifact as never[]),
      ...(ATTESTED_WORLD_ID_FRAGMENTS as readonly string[]),
    ] as never);
    cached = {
      iface: merged,
      origin: `artifact+fragments (artifact lacked: ${missing.join(", ")})`,
      path: abiArtifactPath("AttestedWorldID"),
    };
    return cached;
  }
  cached = {
    iface: new Interface([...ATTESTED_WORLD_ID_FRAGMENTS] as string[]),
    origin: "fragments",
  };
  return cached;
}

/** Minimal AttestorStash (0xFD4) surface used by `check`. */
export const ATTESTOR_STASH_FRAGMENTS = [
  "function getAttestorsCount(uint64 chainKey) view returns (uint32)",
];

export const attestorStashInterface = new Interface(ATTESTOR_STASH_FRAGMENTS);

/** Minimal HumanRegistry / CreditLine reads used by `status`. */
export const HUMAN_REGISTRY_FRAGMENTS = ["function humanCount() view returns (uint256)"];
export const CREDIT_LINE_FRAGMENTS = [
  "function totalAssets() view returns (uint256)",
  "function totalBorrowed() view returns (uint256)",
];
