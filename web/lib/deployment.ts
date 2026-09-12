/**
 * Resolve a deployment document into contract addresses the app can use.
 *
 * Humanline ships two deployments against the same relayed roots:
 *
 *   demo        HumanRegistry + CreditLine verifying against the *Sepolia staging*
 *               AttestedWorldID instance, 10-minute terms. Anyone can reproduce it
 *               with World's simulator, which is why judges get it by default.
 *   production  The same contracts verifying against the *Ethereum mainnet* Orb tree,
 *               30-day terms. This is the one a real Orb-verified human uses.
 *
 * Both are plain deployment JSON documents written by `contracts/script/deploy-cc3.sh`,
 * so one resolver serves both. `lib/contracts.ts` binds this to the default (demo)
 * document and keeps the flat API the static pages use; `lib/profiles.ts` binds it to
 * both and is what `/app` selects between at runtime.
 *
 * The parser accepts every reasonable document shape rather than betting on one: a flat
 * `{ Name: "0x…" }` map, a nested `{ contracts: { Name: "0x…" } }`, or entries of the
 * form `{ Name: { address: "0x…", block: 123 } }`, with keys matched case- and
 * separator-insensitively. A document that resolves nothing is not an error: the UI
 * renders a "not deployed yet" banner and no page crashes.
 */

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

function lookupIn(candidates: Map<string, unknown>, meta: ContractMeta): unknown {
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
function txHashesIn(doc: unknown): Map<string, unknown> {
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
}

function lookupTxHash(txHashes: Map<string, unknown>, meta: ContractMeta): `0x${string}` | undefined {
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

/** Everything the app knows about one deployment document. */
export type Deployment = {
  /** Addresses by contract key, always complete — unresolved entries carry no address. */
  contracts: Record<ContractKey, ResolvedContract>;
  list: ResolvedContract[];
  status: DeploymentStatus;
  /** Raw `config` block from the deployment file, when it has one. */
  config: DeploymentConfig;
  addressOf: (key: ContractKey) => `0x${string}` | undefined;
  deploymentBlockOf: (key: ContractKey) => bigint;
  deploymentTxHashOf: (key: ContractKey) => `0x${string}` | undefined;
};

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

/** The `config` block `deploy-cc3.sh` writes next to the addresses. */
export type DeploymentConfig = {
  /** Which AttestedWorldID instance the registry verifies against. */
  worldIdSource?: "mainnet" | "sepolia";
  appId?: string;
  action?: string;
  termSeconds?: number;
  graceSeconds?: number;
  initialLimit?: number;
  maxLimit?: number;
  feeBps?: number;
  sourceBlockTime?: number;
};

function configOf(doc: unknown): DeploymentConfig {
  if (!isRecord(doc) || !isRecord(doc.config)) return {};
  const raw = doc.config;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  const source = str(raw.worldIdSource);
  return {
    worldIdSource: source === "mainnet" || source === "sepolia" ? source : undefined,
    appId: str(raw.appId),
    action: str(raw.action),
    termSeconds: num(raw.termSeconds),
    graceSeconds: num(raw.graceSeconds),
    initialLimit: num(raw.initialLimit),
    maxLimit: num(raw.maxLimit),
    feeBps: num(raw.feeBps),
    sourceBlockTime: num(raw.sourceBlockTime),
  };
}

/**
 * Resolve one deployment document.
 *
 * `envAddresses` is the per-contract `NEXT_PUBLIC_*_ADDRESS` fallback map. Only the
 * default deployment passes one — an env override that silently repointed *both*
 * profiles at the same registry would be worse than no override at all.
 */
export function buildDeployment(
  doc: unknown,
  envAddresses?: Partial<Record<ContractKey, string | undefined>>,
): Deployment {
  const candidates = flattenCandidates(doc);
  const txHashes = txHashesIn(doc);

  const globalDeploymentBlock: bigint | undefined = (() => {
    if (isRecord(doc)) {
      for (const field of ["deploymentBlock", "startBlock", "blockNumber", "block"]) {
        const value = asBlock(doc[field]);
        if (value !== undefined) return value;
      }
    }
    const envBlock = process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK;
    return envBlock && /^\d+$/.test(envBlock) ? BigInt(envBlock) : undefined;
  })();

  const resolveOne = (meta: ContractMeta): ResolvedContract => {
    const entry = lookupIn(candidates, meta);
    const fromFile = asAddress(entry);
    if (fromFile) {
      return {
        key: meta.key,
        name: meta.name,
        blurb: meta.blurb,
        envVar: meta.envVar,
        address: fromFile,
        deploymentBlock: asBlock(entry) ?? globalDeploymentBlock,
        deploymentTxHash: lookupTxHash(txHashes, meta),
        source: "deployments",
      };
    }
    const fromEnv = asAddress(envAddresses?.[meta.key]);
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
    return { key: meta.key, name: meta.name, blurb: meta.blurb, envVar: meta.envVar, source: "missing" };
  };

  const contracts = Object.fromEntries(
    CONTRACT_META.map((meta) => [meta.key, resolveOne(meta)]),
  ) as Record<ContractKey, ResolvedContract>;
  const list = CONTRACT_META.map((meta) => contracts[meta.key]);

  const deployed = list.filter((c) => c.address);
  const undeployed = list.filter((c) => !c.address);
  const sources = new Set(deployed.map((c) => c.source));
  const status: DeploymentStatus = {
    ready: undeployed.length === 0,
    missing: deployed.length === 0,
    partial: deployed.length > 0 && undeployed.length > 0,
    deployed,
    undeployed,
    source:
      deployed.length === 0
        ? "none"
        : sources.size > 1
          ? "mixed"
          : (deployed[0].source as "deployments" | "env"),
  };

  return {
    contracts,
    list,
    status,
    config: configOf(doc),
    addressOf: (key) => contracts[key].address,
    deploymentBlockOf: (key) => contracts[key].deploymentBlock ?? globalDeploymentBlock ?? 0n,
    deploymentTxHashOf: (key) => contracts[key].deploymentTxHash,
  };
}

/** Display name for a contract key. */
export function nameOf(key: ContractKey): string {
  return META_BY_KEY.get(key)?.name ?? key;
}

/** The two `AttestedWorldID` instances, paired with their source chain. */
export const WORLD_ID_INSTANCES = [
  { chainKey: 3 as const, key: "attestedWorldIDMainnet" as const },
  { chainKey: 1 as const, key: "attestedWorldIDSepolia" as const },
];
