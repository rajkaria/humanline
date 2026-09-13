/**
 * The default deployment, plus the World ID environment the app verifies against.
 *
 * Humanline ships two deployments against the same Attestcoin-relayed roots (see
 * `lib/profiles.ts`). This module binds the resolver in `lib/deployment.ts` to the
 * *default* one — the demo profile, which verifies against the Sepolia staging tree
 * and is what every static page (`/`, `/relay`, `/judge`, `/docs`) describes, because
 * it is the one a judge can reproduce end to end with World's simulator.
 *
 * `/app` picks a profile at runtime instead; it reads addresses from
 * `useProfile()`, never from here.
 *
 * Resolution order, per contract:
 *   1. `deployments/cc3-testnet.json`, snapshotted into `lib/generated/deployments.json`
 *      by `scripts/sync-artifacts.ts` (runs before `dev` and `build`).
 *   2. `NEXT_PUBLIC_*_ADDRESS` environment variables.
 *   3. Nothing — {@link deploymentStatus} reports `missing` and the UI renders a
 *      "Not deployed yet" banner. The build never fails and no page crashes.
 */

import { buildDeployment, type ContractKey } from "@/lib/deployment";
import rawDeployments from "./generated/deployments.json";

export {
  CONTRACT_META,
  nameOf,
  WORLD_ID_INSTANCES,
  type ContractKey,
  type ContractMeta,
  type Deployment,
  type DeploymentConfig,
  type DeploymentStatus,
  type ResolvedContract,
} from "@/lib/deployment";

/** Environment lookups have to be static property accesses to be inlined by Next. */
const ENV_ADDRESSES: Record<ContractKey, string | undefined> = {
  attestedWorldIDMainnet: process.env.NEXT_PUBLIC_ATTESTED_WORLD_ID_MAINNET_ADDRESS,
  attestedWorldIDSepolia: process.env.NEXT_PUBLIC_ATTESTED_WORLD_ID_SEPOLIA_ADDRESS,
  humanRegistry: process.env.NEXT_PUBLIC_HUMAN_REGISTRY_ADDRESS,
  creditLine: process.env.NEXT_PUBLIC_CREDIT_LINE_ADDRESS,
  husd: process.env.NEXT_PUBLIC_HUSD_ADDRESS,
  humanGate: process.env.NEXT_PUBLIC_HUMAN_GATE_ADDRESS,
  relayReward: process.env.NEXT_PUBLIC_RELAY_REWARD_ADDRESS,
  humanLinks: process.env.NEXT_PUBLIC_HUMAN_LINKS_ADDRESS,
  creditHistory: process.env.NEXT_PUBLIC_CREDIT_HISTORY_ADDRESS,
  ethRepay: process.env.NEXT_PUBLIC_ETH_REPAY_ADDRESS,
};

export const DEFAULT_DEPLOYMENT = buildDeployment(rawDeployments as unknown, ENV_ADDRESSES);

export const CONTRACTS = DEFAULT_DEPLOYMENT.contracts;
export const CONTRACT_LIST = DEFAULT_DEPLOYMENT.list;
export const deploymentStatus = DEFAULT_DEPLOYMENT.status;

/** Address for a contract, or `undefined` when it has not been deployed yet. */
export const addressOf = DEFAULT_DEPLOYMENT.addressOf;

/**
 * Lower bound for `getLogs` scans. Falls back to 0 so a fresh deployment still
 * renders; the relay page pages forward in 50k-block windows either way.
 */
export const deploymentBlockOf = DEFAULT_DEPLOYMENT.deploymentBlockOf;

/** The deploy transaction hash, when the deployments file records one. */
export const deploymentTxHashOf = DEFAULT_DEPLOYMENT.deploymentTxHashOf;

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
/**
 * `staging` drives the World ID Simulator; `production` drives World App.
 *
 * This is the *default* profile's environment. `/app` takes it from the selected
 * profile instead, because the environment and the registry have to agree: a
 * production (Orb) proof only verifies against the registry wired to the mainnet
 * tree, and a staging proof only against the one wired to Sepolia.
 */
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
