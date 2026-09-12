// Configuration: env loading, source-chain definitions, deployment address resolution.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/** worker/ package root (this file lives in worker/src). */
export const WORKER_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
/** Repository root. */
export const REPO_ROOT = resolve(WORKER_ROOT, "..");

// ---------------------------------------------------------------------------
// Creditcoin CC3 testnet
// ---------------------------------------------------------------------------

export const CC3_CHAIN_ID = 102031;
export const CC3_RPC_DEFAULT = "https://rpc.cc3-testnet.creditcoin.network";
export const PROVER_URL_DEFAULT = "https://prover.cc3-testnet.creditcoin.network";
export const CC3_EXPLORER = "https://creditcoin-testnet.blockscout.com";

export const BLOCK_PROVER_PRECOMPILE = "0x0000000000000000000000000000000000000FD2";
export const CHAIN_INFO_PRECOMPILE = "0x0000000000000000000000000000000000000fD3";
export const ATTESTOR_STASH_PRECOMPILE = "0x0000000000000000000000000000000000000fd4";

/** bn128 precompiles used by the Semaphore/Groth16 verifier. */
export const BN128_ADD = "0x0000000000000000000000000000000000000006";
export const BN128_MUL = "0x0000000000000000000000000000000000000007";
export const BN128_PAIRING = "0x0000000000000000000000000000000000000008";

// ---------------------------------------------------------------------------
// World ID
// ---------------------------------------------------------------------------

export const TREE_CHANGED_TOPIC =
  "0x25f6d5cc356ee0b49cf708c13c68197947f5740a878a298765e4b18e4afdaf04";
export const SELECTOR_REGISTER_IDENTITIES = "0x2217b211";
export const SELECTOR_DELETE_IDENTITIES = "0xea10fbbe";

/** `execute(action, ...)` discriminator for a World ID root update. */
export const ACTION_ROOT_UPDATE = 0;

// ---------------------------------------------------------------------------
// Source chains
// ---------------------------------------------------------------------------

export type SourceName = "mainnet" | "sepolia";
export const SOURCE_NAMES: SourceName[] = ["mainnet", "sepolia"];

export interface SourceConfig {
  name: SourceName;
  /** Attestcoin chainKey for this source chain on Creditcoin. */
  chainKey: number;
  /** World ID identity manager that emits TreeChanged. */
  manager: string;
  /** Env var holding the source-chain RPC URL. */
  rpcEnv: string;
  defaultRpc: string;
  /**
   * Tried in order when the configured RPC refuses a request. The public default for
   * mainnet rejects `eth_getLogs` outright ("Archive requests require a personal token"),
   * so the worker fails over instead of going blind.
   */
  fallbackRpcs: string[];
  /** Key inside deployments `contracts` object. */
  deploymentKey: "AttestedWorldIDMainnet" | "AttestedWorldIDSepolia";
  /** Blocks behind the attested tip before a root is accepted on-chain. */
  finalityDepth: number;
  explorerTx: (hash: string) => string;
}

export const SOURCES: Record<SourceName, SourceConfig> = {
  mainnet: {
    name: "mainnet",
    chainKey: 3,
    manager: "0xf7134CE138832c1456F2a91D64621eE90c2bddEa",
    rpcEnv: "ETH_MAINNET_RPC",
    defaultRpc: "https://ethereum-rpc.publicnode.com",
    fallbackRpcs: ["https://mainnet.gateway.tenderly.co", "https://gateway.tenderly.co/public/mainnet"],
    deploymentKey: "AttestedWorldIDMainnet",
    finalityDepth: 32,
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
  },
  sepolia: {
    name: "sepolia",
    chainKey: 1,
    manager: "0xb2ead588f14e69266d1b87936b75325181377076",
    rpcEnv: "ETH_SEPOLIA_RPC",
    defaultRpc: "https://ethereum-sepolia-rpc.publicnode.com",
    fallbackRpcs: ["https://sepolia.gateway.tenderly.co"],
    deploymentKey: "AttestedWorldIDSepolia",
    finalityDepth: 32,
    explorerTx: (h) => `https://sepolia.etherscan.io/tx/${h}`,
  },
};

export function parseSourceArg(value: string): SourceName[] {
  if (value === "all") return [...SOURCE_NAMES];
  if (value === "mainnet" || value === "sepolia") return [value];
  throw new Error(`unknown --source "${value}" (expected mainnet, sepolia or all)`);
}

export function sourceByChainKey(chainKey: number): SourceConfig | undefined {
  return SOURCE_NAMES.map((n) => SOURCES[n]).find((s) => s.chainKey === chainKey);
}

// ---------------------------------------------------------------------------
// Relay tuning
// ---------------------------------------------------------------------------

/** eth_getLogs window size (public RPCs commonly cap at 10k; we use half). */
export const LOG_WINDOW = 5_000;
/** Max block span inside one executeBatch (shared continuity proof). */
export const BATCH_MAX_SPAN = 1_000;
/** Max transactions in one executeBatch. */
export const BATCH_MAX_SIZE = 10;
/** Continuous relay poll interval. */
export const POLL_INTERVAL_MS = 60_000;
/** How far back a fresh worker starts when it has no cursor at all. */
export const DEFAULT_LOOKBACK_BLOCKS = 7_200;

// ---------------------------------------------------------------------------
// dotenv-style loader (no dependency; never overrides an existing env var)
// ---------------------------------------------------------------------------

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // strip an unquoted trailing comment
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Loads env files into process.env without overriding anything already set.
 * Order: explicit --env-file, then worker/.env, then repo .secrets.env.
 * Returns the list of files actually read (for diagnostics; values are never printed).
 */
export function loadEnvFiles(explicit?: string): string[] {
  const explicitPath = explicit
    ? isAbsolute(explicit)
      ? explicit
      : resolve(process.cwd(), explicit)
    : undefined;
  const candidates = [explicitPath, resolve(WORKER_ROOT, ".env"), resolve(REPO_ROOT, ".secrets.env")]
    .filter((p): p is string => Boolean(p));

  const loaded: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) {
      if (path === explicitPath) throw new Error(`--env-file not found: ${path}`);
      continue;
    }
    const vars = parseEnvFile(readFileSync(path, "utf8"));
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    loaded.push(path);
  }
  return loaded;
}

export function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function cc3RpcUrl(): string {
  return env("CC3_RPC", CC3_RPC_DEFAULT);
}

export function proverUrl(): string {
  return env("PROVER_URL", PROVER_URL_DEFAULT);
}

export function sourceRpcUrl(source: SourceConfig): string {
  return env(source.rpcEnv, source.defaultRpc);
}

/**
 * RPC URLs to try, in order. An explicit env override is honoured first (comma-separated
 * lists are allowed); the built-in fallbacks always come last so a private endpoint that
 * hiccups still degrades to something that works.
 */
export function sourceRpcUrls(source: SourceConfig): string[] {
  const configured = process.env[source.rpcEnv];
  const primary = configured
    ? configured.split(",").map((s) => s.trim()).filter(Boolean)
    : [source.defaultRpc];
  const seen = new Set(primary);
  return [...primary, ...source.fallbackRpcs.filter((u) => !seen.has(u))];
}

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

export interface Deployments {
  chainId: number;
  /** Deployment transaction per contract; used to bound on-chain log scans. */
  txHashes?: Record<string, string | undefined>;
  contracts: {
    AttestedWorldIDMainnet?: string;
    AttestedWorldIDSepolia?: string;
    HUSD?: string;
    HumanRegistry?: string;
    CreditLine?: string;
    HumanGate?: string;
    [k: string]: string | undefined;
  };
}

export type DeploymentsResult =
  | { ok: true; path: string; data: Deployments }
  | { ok: false; path: string; reason: string };

export function deploymentsPath(override?: string): string {
  const raw = override ?? process.env.DEPLOYMENTS_FILE ?? "../deployments/cc3-testnet.json";
  if (isAbsolute(raw)) return raw;
  // An explicit override (flag or env) is relative to cwd; the default is relative to worker/.
  const base = (override ?? process.env.DEPLOYMENTS_FILE) ? process.cwd() : WORKER_ROOT;
  return resolve(base, raw);
}

export function loadDeployments(override?: string): DeploymentsResult {
  const path = deploymentsPath(override);
  if (!existsSync(path)) {
    return { ok: false, path, reason: "file does not exist" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, path, reason: `invalid JSON: ${(e as Error).message}` };
  }
  const data = parsed as Deployments;
  if (!data || typeof data !== "object" || !data.contracts) {
    return { ok: false, path, reason: "missing `contracts` object" };
  }
  return { ok: true, path, data };
}

export const NOT_DEPLOYED_EXIT_CODE = 2;

/** Prints a clear message and exits 2 when the deployments file is absent/unusable. */
export function requireDeployments(override?: string): { path: string; data: Deployments } {
  const res = loadDeployments(override);
  if (!res.ok) {
    console.error(
      [
        "",
        "  Humanline contracts are not deployed yet.",
        `  Expected a deployments file at: ${res.path}`,
        `  Reason: ${res.reason}`,
        "",
        "  Shape:",
        '    { "chainId": 102031, "contracts": { "AttestedWorldIDMainnet": "0x...",',
        '      "AttestedWorldIDSepolia": "0x...", "HUSD": "0x...", "HumanRegistry": "0x...",',
        '      "CreditLine": "0x...", "HumanGate": "0x..." } }',
        "",
        "  Point DEPLOYMENTS_FILE (or --deployments) at another path if it lives elsewhere.",
        "  Read-only paths that need no deployment: `check`, `prove --dry-run`, `relay --dry-run`.",
        "",
      ].join("\n"),
    );
    process.exit(NOT_DEPLOYED_EXIT_CODE);
  }
  return { path: res.path, data: res.data };
}

/** Address of the AttestedWorldID instance for a source, or undefined. */
export function attestedWorldIdAddress(
  deployments: Deployments | undefined,
  source: SourceConfig,
): string | undefined {
  const addr = deployments?.contracts?.[source.deploymentKey];
  return addr && /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : undefined;
}

/** The deploy transaction for a source's AttestedWorldID, when the file records one. */
export function deploymentTxHash(
  deployments: Deployments | undefined,
  source: SourceConfig,
): string | undefined {
  const h = deployments?.txHashes?.[source.deploymentKey];
  return h && /^0x[0-9a-fA-F]{64}$/.test(h) ? h : undefined;
}

export function evidencePath(override?: string): string {
  const raw = override ?? process.env.EVIDENCE_FILE ?? "evidence/relay-log.jsonl";
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
}

export function dbPath(override?: string): string {
  const raw = override ?? process.env.WORKER_DB ?? "data/relay.db";
  if (raw === ":memory:") return raw;
  return isAbsolute(raw) ? raw : resolve(WORKER_ROOT, raw);
}

/** Signer key, never logged. */
export function privateKey(): string | undefined {
  const k = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  if (!k) return undefined;
  return k.startsWith("0x") ? k : `0x${k}`;
}
