/**
 * Where the contracts live, and what to render when they do not live anywhere yet.
 *
 * Resolution order, per contract:
 *   1. `deployments/cc3-testnet.json`, snapshotted into `lib/generated/deployments.json`
 *      by `scripts/sync-artifacts.ts` (runs before `dev` and `build`).
 *   2. `NEXT_PUBLIC_*_ADDRESS` environment variables.
 *   3. Nothing — {@link deploymentStatus} reports `missing` and the UI renders a
 *      "Not deployed yet" banner. The build never fails and no page crashes.
 *
 * The deployments file is written by a sibling task, so the parser accepts every
 * reasonable shape rather than betting on one: a flat `{ Name: "0x…" }` map, a
 * nested `{ contracts: { Name: "0x…" } }`, or entries of the form
 * `{ Name: { address: "0x…", block: 123 } }`, with keys matched case- and
 * separator-insensitively.
 */

import rawDeployments from "./generated/deployments.json";

export type ContractKey =
  | "attestedWorldIDMainnet"
  | "attestedWorldIDSepolia"
  | "humanRegistry"
  | "creditLine"
  | "husd"
  | "humanGate";

export type ContractMeta = {
  key: ContractKey;
  /** Name as it appears in `contracts/src` and on Blockscout. */
  name: string;
  /** One line explaining what it does, used on `/judge` and `/docs`. */
  blurb: string;
  /** Environment variable consulted when the deployments file has no entry. */
  envVar: string;
  /** Alternative spellings that may appear as keys in the deployments file. */
  aliases: string[];
};

export const CONTRACT_META: ContractMeta[] = [
  {
    key: "attestedWorldIDMainnet",
    name: "AttestedWorldID (Ethereum mainnet)",
    blurb:
      "World's bridged-root contract, fed by Attestcoin proofs of real registerIdentities transactions on Ethereum mainnet (chainKey 3).",
    envVar: "NEXT_PUBLIC_ATTESTED_WORLD_ID_MAINNET_ADDRESS",
    aliases: [
      "attestedworldidmainnet",
      "attestedworldid_mainnet",
      "attestedworldidethereum",
      "attestedworldid3",
      "worldidmainnet",
    ],
  },
  {
    key: "attestedWorldIDSepolia",
    name: "AttestedWorldID (Sepolia staging)",
    blurb:
      "The same contract pointed at World's Sepolia staging identity manager (chainKey 1) — the judge-reproducible path.",
    envVar: "NEXT_PUBLIC_ATTESTED_WORLD_ID_SEPOLIA_ADDRESS",
    aliases: [
      "attestedworldidsepolia",
      "attestedworldid_sepolia",
      "attestedworldidstaging",
      "attestedworldid1",
      "worldidsepolia",
    ],
  },
  {
    key: "humanRegistry",
    name: "HumanRegistry",
    blurb:
      "Verifies a Semaphore proof against an Attestcoin-relayed root and binds the World ID nullifier to a Creditcoin wallet.",
    envVar: "NEXT_PUBLIC_HUMAN_REGISTRY_ADDRESS",
    aliases: ["humanregistry", "registry"],
  },
  {
    key: "creditLine",
    name: "CreditLine",
    blurb:
      "Lender-funded pool. One uncollateralised line per human, keyed by nullifier, not by wallet.",
    envVar: "NEXT_PUBLIC_CREDIT_LINE_ADDRESS",
    aliases: ["creditline", "credit_line", "line", "pool"],
  },
  {
    key: "husd",
    name: "hUSD",
    blurb: "The demo stablecoin: 6 decimals, no owner, 100 hUSD faucet once per 24h.",
    envVar: "NEXT_PUBLIC_HUSD_ADDRESS",
    aliases: ["husd", "hUSD", "humanlineusd", "asset", "stablecoin"],
  },
  {
    key: "humanGate",
    name: "HumanGate",
    blurb:
      "Twenty-line example integration: claim once per human. The pattern any Creditcoin contract can copy.",
    envVar: "NEXT_PUBLIC_HUMAN_GATE_ADDRESS",
    aliases: ["humangate", "gate", "example"],
  },
];

const META_BY_KEY = new Map(CONTRACT_META.map((m) => [m.key, m]));

/** Environment lookups have to be static property accesses to be inlined by Next. */
const ENV_ADDRESSES: Record<ContractKey, string | undefined> = {
  attestedWorldIDMainnet: process.env.NEXT_PUBLIC_ATTESTED_WORLD_ID_MAINNET_ADDRESS,
  attestedWorldIDSepolia: process.env.NEXT_PUBLIC_ATTESTED_WORLD_ID_SEPOLIA_ADDRESS,
  humanRegistry: process.env.NEXT_PUBLIC_HUMAN_REGISTRY_ADDRESS,
  creditLine: process.env.NEXT_PUBLIC_CREDIT_LINE_ADDRESS,
  husd: process.env.NEXT_PUBLIC_HUSD_ADDRESS,
  humanGate: process.env.NEXT_PUBLIC_HUMAN_GATE_ADDRESS,
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asAddress(value: unknown): `0x${string}` | undefined {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim())) {
    return value.trim() as `0x${string}`;
  }
  if (isRecord(value)) {
    for (const field of ["address", "Address", "addr", "contract"]) {
      const nested = asAddress(value[field]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function asBlock(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  if (isRecord(value)) {
    for (const field of ["block", "blockNumber", "deploymentBlock", "startBlock", "deployedAt"]) {
      const nested = asBlock(value[field]);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/** Flatten the deployments document into `normalisedKey → value` pairs. */
function flattenCandidates(doc: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!isRecord(doc)) return out;

  const scopes: UnknownRecord[] = [doc];
  for (const container of ["contracts", "addresses", "deployments", "artifacts"]) {
    const nested = doc[container];
    if (isRecord(nested)) scopes.push(nested);
  }

  for (const scope of scopes) {
    for (const [key, value] of Object.entries(scope)) {
      const normalised = normaliseKey(key);
      if (!out.has(normalised)) out.set(normalised, value);
    }
  }
  return out;
}

const candidates = flattenCandidates(rawDeployments as unknown);

function lookup(meta: ContractMeta): unknown {
  for (const alias of [normaliseKey(meta.key), normaliseKey(meta.name), ...meta.aliases.map(normaliseKey)]) {
    if (candidates.has(alias)) return candidates.get(alias);
  }
  return undefined;
}

export type ResolvedContract = {
  key: ContractKey;
  name: string;
  blurb: string;
  envVar: string;
  address?: `0x${string}`;
  /** Block the contract was deployed at, used as the `getLogs` lower bound. */
  deploymentBlock?: bigint;
  /** The deploy transaction, when the deployments file records one. */
  deploymentTxHash?: `0x${string}`;
  source: "deployments" | "env" | "missing";
};

/**
 * `txHashes` in the deployments file, keyed the same way as `contracts`.
 *
 * The file records *when* a contract was deployed as a wall-clock timestamp, not
 * as a block number — but the deploy transaction hash pins the block exactly, so
 * the log scanners resolve the `getLogs` lower bound from the receipt instead of
 * scanning from genesis. See `lib/hooks/use-deployment-block.ts`.
 */
const txHashes: Map<string, unknown> = (() => {
  const doc = rawDeployments as unknown;
  const out = new Map<string, unknown>();
  if (!isRecord(doc)) return out;
  for (const container of ["txHashes", "transactions", "deployTxHashes"]) {
    const nested = doc[container];
    if (!isRecord(nested)) continue;
    for (const [key, value] of Object.entries(nested)) {
      const normalised = normaliseKey(key);
      if (!out.has(normalised)) out.set(normalised, value);
    }
  }
  return out;
})();

function lookupTxHash(meta: ContractMeta): `0x${string}` | undefined {
  for (const alias of [
    normaliseKey(meta.key),
    normaliseKey(meta.name),
    ...meta.aliases.map(normaliseKey),
  ]) {
    const value = txHashes.get(alias);
    if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) {
      return value as `0x${string}`;
    }
  }
  return undefined;
}

function resolveOne(meta: ContractMeta): ResolvedContract {
  const entry = lookup(meta);
  const fromFile = asAddress(entry);
  if (fromFile) {
    return {
      key: meta.key,
      name: meta.name,
      blurb: meta.blurb,
      envVar: meta.envVar,
      address: fromFile,
      deploymentBlock: asBlock(entry) ?? globalDeploymentBlock,
      deploymentTxHash: lookupTxHash(meta),
      source: "deployments",
    };
  }
  const fromEnv = asAddress(ENV_ADDRESSES[meta.key]);
  if (fromEnv) {
    return {
      key: meta.key,
      name: meta.name,
      blurb: meta.blurb,
      envVar: meta.envVar,
      address: fromEnv,
      deploymentBlock: globalDeploymentBlock,
      source: "env",
    };
  }
  return {
    key: meta.key,
    name: meta.name,
    blurb: meta.blurb,
    envVar: meta.envVar,
    source: "missing",
  };
}

/** A document-level deployment block, when the deploy script records only one. */
const globalDeploymentBlock: bigint | undefined = (() => {
  const doc = rawDeployments as unknown;
  if (!isRecord(doc)) return undefined;
  for (const field of ["deploymentBlock", "startBlock", "blockNumber", "block"]) {
    const value = asBlock(doc[field]);
    if (value !== undefined) return value;
  }
  const envBlock = process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK;
  return envBlock && /^\d+$/.test(envBlock) ? BigInt(envBlock) : undefined;
})();

export const CONTRACTS: Record<ContractKey, ResolvedContract> = Object.fromEntries(
  CONTRACT_META.map((meta) => [meta.key, resolveOne(meta)]),
) as Record<ContractKey, ResolvedContract>;

export const CONTRACT_LIST: ResolvedContract[] = CONTRACT_META.map(
  (meta) => CONTRACTS[meta.key],
);

/** Address for a contract, or `undefined` when it has not been deployed yet. */
export function addressOf(key: ContractKey): `0x${string}` | undefined {
  return CONTRACTS[key].address;
}

/** Display name for a contract key. */
export function nameOf(key: ContractKey): string {
  return META_BY_KEY.get(key)?.name ?? key;
}

/**
 * Lower bound for `getLogs` scans. Falls back to 0 so a fresh deployment still
 * renders; the relay page pages forward in 50k-block windows either way.
 */
export function deploymentBlockOf(key: ContractKey): bigint {
  return CONTRACTS[key].deploymentBlock ?? globalDeploymentBlock ?? 0n;
}

/** The deploy transaction hash, when the deployments file records one. */
export function deploymentTxHashOf(key: ContractKey): `0x${string}` | undefined {
  return CONTRACTS[key].deploymentTxHash;
}

export type DeploymentStatus = {
  /** Every contract resolved. */
  ready: boolean;
  /** Nothing resolved at all — the deploy task has not run. */
  missing: boolean;
  /** Some resolved, some did not. */
  partial: boolean;
  deployed: ResolvedContract[];
  undeployed: ResolvedContract[];
  /** Where the resolved addresses came from, for the `/judge` provenance line. */
  source: "deployments" | "env" | "mixed" | "none";
};

export const deploymentStatus: DeploymentStatus = (() => {
  const deployed = CONTRACT_LIST.filter((c) => c.address);
  const undeployed = CONTRACT_LIST.filter((c) => !c.address);
  const sources = new Set(deployed.map((c) => c.source));
  const source =
    deployed.length === 0
      ? ("none" as const)
      : sources.size > 1
        ? ("mixed" as const)
        : (deployed[0].source as "deployments" | "env");
  return {
    ready: undeployed.length === 0,
    missing: deployed.length === 0,
    partial: deployed.length > 0 && undeployed.length > 0,
    deployed,
    undeployed,
    source,
  };
})();

/** The two `AttestedWorldID` instances, paired with their source chain. */
export const WORLD_ID_INSTANCES = [
  { chainKey: 3 as const, key: "attestedWorldIDMainnet" as const },
  { chainKey: 1 as const, key: "attestedWorldIDSepolia" as const },
];

// ---------------------------------------------------------------- World ID env

/**
 * The Developer Portal app id for Humanline's verification action.
 *
 * Overridable per deployment; the default is the registered Humanline app so a
 * checkout with no `.env.local` still runs the real flow.
 */
export const WORLD_APP_ID = (process.env.NEXT_PUBLIC_WORLD_APP_ID ||
  "app_87b24915fcf733f10df1b0c46dd1f783") as `app_${string}`;
/** The registered relying-party id whose key signs proof requests (IDKit 4.x). */
export const WORLD_RP_ID =
  process.env.NEXT_PUBLIC_WORLD_RP_ID || "rp_84b02642423cadf5";
/** The action string. Must match `HumanRegistry.ACTION()`. */
export const WORLD_ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION || "humanline-register";
/** `staging` drives the World ID Simulator; `production` drives World App. */
export const WORLD_ENV = ((): "production" | "staging" | "sandbox" => {
  const value = process.env.NEXT_PUBLIC_WORLD_ENV;
  return value === "production" || value === "sandbox" ? value : "staging";
})();

export type WorldIdSetupIssue = { envVar: string; what: string };

/**
 * Client-visible World ID configuration gaps.
 *
 * The app id and RP id have registered defaults, so the only thing that can be
 * missing at build time is an explicit override. The server-side signing key is
 * checked by `/api/world/rp-context`, which reports its own 503 — see
 * `components/verify-card.tsx`.
 */
export const worldIdSetupIssues: WorldIdSetupIssue[] = [
  !WORLD_APP_ID && {
    envVar: "NEXT_PUBLIC_WORLD_APP_ID",
    what: "Developer Portal app id (app_…) for the Humanline verification action.",
  },
  !WORLD_RP_ID && {
    envVar: "NEXT_PUBLIC_WORLD_RP_ID",
    what: "Relying-party id (rp_…) — IDKit 4.x signs every proof request against it.",
  },
].filter((issue): issue is WorldIdSetupIssue => Boolean(issue));

export const worldIdConfigured = worldIdSetupIssues.length === 0;

/** The World ID Simulator, used to produce staging proofs during the demo. */
export const WORLD_SIMULATOR_URL = "https://simulator.worldcoin.org";
